#!/usr/bin/env node

/**
 * Vigilante opcional de buzón.
 * Reacciona a mensajes nuevos despertando al rol correspondiente mediante claude -p o agy -p con prompt fijo.
 * Topes estrictos: máx 6 invocaciones por hora, 30 por día.
 * Uso:
 *   node scripts/vigilante.js iniciar [--rol claude|antigravity] [--intervalo 20]
 *   node scripts/vigilante.js detener
 *   node scripts/vigilante.js estado
 *   node scripts/vigilante.js una-vez
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  encontrarRaizRepositorio,
  obtenerRutaCoordinacion,
  leerTodosLosMensajes,
  registrarAuditoria
} from '../src/almacen.js';

export const PROMPT_FIJO = 'Hay mensajes nuevos en tu buzón. Usa leer_buzon y atiéndelos. No apruebes migraciones, verify ni despliegues.';
export const MAX_INVOCACIONES_HORA = 6;
export const MAX_INVOCACIONES_DIA = 30;
export const TIMEOUT_INVOCACION_MS = 10 * 60 * 1000; // 10 minutos

export function obtenerComandoParaRol(rol) {
  if (rol === 'claude') {
    return {
      cmd: process.env.CLAUDE_PATH || 'C:\\Users\\Gustavo\\AppData\\Roaming\\npm\\claude.cmd',
      args: ['-p', PROMPT_FIJO]
    };
  } else if (rol === 'antigravity') {
    return {
      cmd: process.env.AGY_PATH || 'C:\\Users\\Gustavo\\.gemini\\bin\\agy.exe',
      args: ['-p', PROMPT_FIJO]
    };
  }
  throw new Error(`Rol desconocido para vigilante: ${rol}`);
}

export class VigilanteMotor {
  constructor({ repoRoot, rolMonitoreado = null, intervaloSeg = 20, ejecutorProceso = null } = {}) {
    this.repoRoot = repoRoot || encontrarRaizRepositorio();
    this.coordDir = obtenerRutaCoordinacion(this.repoRoot);
    this.rolMonitoreado = rolMonitoreado; // si es null, vigila ambos roles
    this.intervaloMs = (intervaloSeg || 20) * 1000;
    this.ejecutorProceso = ejecutorProceso || this.ejecutarComandoReal.bind(this);
    this.estadoPath = path.join(this.coordDir, 'sesiones', 'vigilante_estado.json');
    this.pidPath = path.join(this.coordDir, 'sesiones', 'vigilante.pid');
    this.procesoEnCurso = false;
    this.temporizador = null;
    this.detenido = false;
  }

  cargarEstado() {
    if (fs.existsSync(this.estadoPath)) {
      try {
        return JSON.parse(fs.readFileSync(this.estadoPath, 'utf8'));
      } catch (_) {}
    }
    return {
      invocaciones: [],
      mensajes_notificados: []
    };
  }

  guardarEstado(estado) {
    fs.mkdirSync(path.dirname(this.estadoPath), { recursive: true });
    fs.writeFileSync(this.estadoPath, JSON.stringify(estado, null, 2), 'utf8');
  }

  comprobarTopes(estado) {
    const ahora = Date.now();
    const unaHoraAtras = ahora - 60 * 60 * 1000;
    const unDiaAtras = ahora - 24 * 60 * 60 * 1000;

    const invocacionesHora = estado.invocaciones.filter(t => t > unaHoraAtras);
    const invocacionesDia = estado.invocaciones.filter(t => t > unDiaAtras);

    if (invocacionesHora.length >= MAX_INVOCACIONES_HORA) {
      return {
        topeAlcanzado: true,
        motivo: `Tope horario alcanzado (${invocacionesHora.length}/${MAX_INVOCACIONES_HORA} invocaciones en la última hora).`
      };
    }

    if (invocacionesDia.length >= MAX_INVOCACIONES_DIA) {
      return {
        topeAlcanzado: true,
        motivo: `Tope diario alcanzado (${invocacionesDia.length}/${MAX_INVOCACIONES_DIA} invocaciones en las últimas 24 horas).`
      };
    }

    return { topeAlcanzado: false };
  }

  async ejecutarComandoReal(rol) {
    const cfg = obtenerComandoParaRol(rol);
    return new Promise((resolve) => {
      const hijo = spawn(cfg.cmd, cfg.args, {
        cwd: this.repoRoot,
        stdio: 'ignore',
        windowsHide: true
      });

      const timer = setTimeout(() => {
        try {
          hijo.kill('SIGKILL');
        } catch (_) {}
        resolve({ timeout: true, codigo: -1 });
      }, TIMEOUT_INVOCACION_MS);

      hijo.on('close', (codigo) => {
        clearTimeout(timer);
        resolve({ timeout: false, codigo });
      });

      hijo.on('error', (err) => {
        clearTimeout(timer);
        resolve({ error: err.message, codigo: -1 });
      });
    });
  }

  async revisarCiclo() {
    if (this.procesoEnCurso || this.detenido) return;

    const estado = this.cargarEstado();
    const verificacionTopes = this.comprobarTopes(estado);
    if (verificacionTopes.topeAlcanzado) {
      console.warn(`[VIGILANTE DETENIDO POR TOPE] ${verificacionTopes.motivo}`);
      registrarAuditoria({
        evento: 'vigilante_tope_alcanzado',
        motivo: verificacionTopes.motivo
      }, this.repoRoot);
      this.detener();
      return;
    }

    const todos = leerTodosLosMensajes(this.repoRoot);
    const setNotificados = new Set(estado.mensajes_notificados || []);

    // Buscar mensajes nuevos cuyo remitente sea el OTRO rol
    const nuevosPorRol = {
      claude: [],
      antigravity: []
    };

    for (const m of todos) {
      if (setNotificados.has(m.id)) continue;
      // Solo mensajes donde remitente sea el otro rol
      if (m.de !== m.para && (m.para === 'claude' || m.para === 'antigravity')) {
        if (!this.rolMonitoreado || this.rolMonitoreado === m.para) {
          nuevosPorRol[m.para].push(m);
        }
      }
    }

    // Elegir el primer rol que tenga mensajes pendientes
    const rolesDisponibles = ['antigravity', 'claude'];
    let rolDestino = null;
    let mensajesAtender = [];

    for (const r of rolesDisponibles) {
      if (nuevosPorRol[r].length > 0) {
        rolDestino = r;
        mensajesAtender = nuevosPorRol[r];
        break;
      }
    }

    if (!rolDestino) {
      return; // No hay mensajes nuevos que atender
    }

    this.procesoEnCurso = true;
    try {
      console.log(`[VIGILANTE] Detectados ${mensajesAtender.length} mensajes nuevos para ${rolDestino}. Invocando ${rolDestino}...`);

      const resultado = await this.ejecutorProceso(rolDestino);

      // Registrar invocación y marcar mensajes como notificados
      const ahora = Date.now();
      estado.invocaciones.push(ahora);
      for (const m of mensajesAtender) {
        setNotificados.add(m.id);
      }
      estado.mensajes_notificados = Array.from(setNotificados);
      this.guardarEstado(estado);

      registrarAuditoria({
        evento: 'vigilante_invocacion',
        rol_despertado: rolDestino,
        mensajes_ids: mensajesAtender.map(m => m.id),
        resultado
      }, this.repoRoot);

      console.log(`[VIGILANTE] Invocación para ${rolDestino} finalizada con código ${resultado.codigo}`);
    } catch (err) {
      console.error(`[VIGILANTE ERROR] ${err.message}`);
    } finally {
      this.procesoEnCurso = false;
    }
  }

  iniciar() {
    this.detenido = false;
    fs.mkdirSync(path.dirname(this.pidPath), { recursive: true });
    fs.writeFileSync(this.pidPath, String(process.pid), 'utf8');

    console.log(`[VIGILANTE] Iniciado en segundo plano (PID: ${process.pid}, Intervalo: ${this.intervaloMs / 1000}s)`);
    console.log(`Topes activos: máx ${MAX_INVOCACIONES_HORA}/hora, ${MAX_INVOCACIONES_DIA}/día.`);

    // Revisar inmediatamente
    this.revisarCiclo();

    this.temporizador = setInterval(() => {
      this.revisarCiclo();
    }, this.intervaloMs);
  }

  detener() {
    this.detenido = true;
    if (this.temporizador) {
      clearInterval(this.temporizador);
      this.temporizador = null;
    }
    if (fs.existsSync(this.pidPath)) {
      try {
        fs.unlinkSync(this.pidPath);
      } catch (_) {}
    }
    console.log('[VIGILANTE] Vigilante detenido limpiamente.');
  }
}

// Ejecución directa por CLI si se llama desde la terminal
const esScriptDirecto = process.argv[1] && (
  process.argv[1].endsWith('vigilante.js') ||
  process.argv[1].endsWith('vigilante')
);

if (esScriptDirecto) {
  const comando = process.argv[2] || 'ayuda';
  const repoRoot = encontrarRaizRepositorio();
  const coordDir = obtenerRutaCoordinacion(repoRoot);
  const pidPath = path.join(coordDir, 'sesiones', 'vigilante.pid');

  if (comando === 'iniciar') {
    const vigilante = new VigilanteMotor({ repoRoot });
    vigilante.iniciar();

    process.on('SIGINT', () => {
      vigilante.detener();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      vigilante.detener();
      process.exit(0);
    });
  } else if (comando === 'detener') {
    if (fs.existsSync(pidPath)) {
      try {
        const pid = Number(fs.readFileSync(pidPath, 'utf8').trim());
        process.kill(pid, 'SIGTERM');
        console.log(`Proceso de vigilante (PID ${pid}) detenido.`);
      } catch (e) {
        console.log(`No se pudo enviar señal al proceso: ${e.message}`);
      }
      try { fs.unlinkSync(pidPath); } catch (_) {}
    } else {
      console.log('No hay proceso de vigilante registrado.');
    }
  } else if (comando === 'estado') {
    const estadoPath = path.join(coordDir, 'sesiones', 'vigilante_estado.json');
    const estaCorriendo = fs.existsSync(pidPath);
    console.log(`Estado del Vigilante: ${estaCorriendo ? 'CORRIENDO' : 'DETENIDO'}`);
    if (fs.existsSync(estadoPath)) {
      const est = JSON.parse(fs.readFileSync(estadoPath, 'utf8'));
      const ahora = Date.now();
      const invocacionesHora = (est.invocaciones || []).filter(t => t > ahora - 3600000).length;
      const invocacionesDia = (est.invocaciones || []).filter(t => t > ahora - 86400000).length;
      console.log(`Invocaciones última hora: ${invocacionesHora}/${MAX_INVOCACIONES_HORA}`);
      console.log(`Invocaciones últimas 24h: ${invocacionesDia}/${MAX_INVOCACIONES_DIA}`);
      console.log(`Mensajes notificados en historial: ${(est.mensajes_notificados || []).length}`);
    }
  } else if (comando === 'una-vez') {
    const vigilante = new VigilanteMotor({ repoRoot });
    vigilante.revisarCiclo().then(() => {
      console.log('Ciclo único de vigilante completado.');
    });
  } else {
    console.log('Uso: node scripts/vigilante.js [iniciar | detener | estado | una-vez]');
  }
}
