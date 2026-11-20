import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  asegurarDirectorios,
  obtenerRutaCoordinacion,
  escribirArchivoAtomico,
  resolverRutaSegura,
  registrarAuditoria
} from './almacen.js';

export const TTL_MINUTOS_DEFECTO = 15;
export const LEASE_RECLAMO_MS = 10 * 60 * 1000; // 10 minutos

export function obtenerTTLMinutos() {
  const ttlEnv = process.env.BUZON_TTL_MIN;
  if (ttlEnv && !isNaN(Number(ttlEnv))) {
    return Math.max(1, Number(ttlEnv));
  }
  return TTL_MINUTOS_DEFECTO;
}

export function generarSesionId(rol) {
  const aleatorio = crypto.randomBytes(4).toString('hex');
  return `s_${Date.now()}_${process.pid}_${aleatorio}`;
}

export class GestorSesiones {
  constructor({ rol, repoRoot, sesionId = null, etiqueta = null } = {}) {
    const miRol = (rol || process.env.BUZON_YO || '').trim().toLowerCase();
    if (!miRol || (miRol !== 'claude' && miRol !== 'antigravity')) {
      throw new Error(`Rol inválido o no especificado: "${miRol}". Debe ser "claude" o "antigravity" (variable BUZON_YO).`);
    }

    this.rol = miRol;
    this.repoRoot = repoRoot;
    this.sesionId = sesionId || generarSesionId(this.rol);
    this.etiqueta = etiqueta || `sesion-${this.rol}-${this.sesionId.slice(-6)}`;
    this.desde = new Date().toISOString();
    this.ultimoLatido = this.desde;
    this.alertaForzado = null;

    this.asegurarEstructura();
    this.registrarSesionActiva();
  }

  asegurarEstructura() {
    asegurarDirectorios(this.repoRoot);
    const coordDir = obtenerRutaCoordinacion(this.repoRoot);
    const dirActivas = path.join(coordDir, 'sesiones', 'activas');
    const dirAlertas = path.join(coordDir, 'sesiones', 'alertas');
    fs.mkdirSync(dirActivas, { recursive: true });
    fs.mkdirSync(dirAlertas, { recursive: true });
  }

  registrarSesionActiva() {
    this.asegurarEstructura();
    const coordDir = obtenerRutaCoordinacion(this.repoRoot);
    const rutaActiva = path.join(coordDir, 'sesiones', 'activas', `${this.sesionId}.json`);
    const data = {
      sesion_id: this.sesionId,
      rol: this.rol,
      etiqueta: this.etiqueta,
      desde: this.desde,
      ultimo_latido: this.ultimoLatido
    };
    escribirArchivoAtomico(rutaActiva, JSON.stringify(data, null, 2));
  }

  actualizarLatido() {
    this.ultimoLatido = new Date().toISOString();
    this.registrarSesionActiva();

    // Si somos primaria actualmente, actualizar también en sesiones/<rol>.json
    const infoPrimaria = this.obtenerPrimaria(this.rol);
    if (infoPrimaria && infoPrimaria.sesion_id === this.sesionId) {
      const coordDir = obtenerRutaCoordinacion(this.repoRoot);
      const rutaPrimaria = path.join(coordDir, 'sesiones', `${this.rol}.json`);
      const dataActualizada = {
        ...infoPrimaria,
        etiqueta: this.etiqueta,
        ultimo_latido: this.ultimoLatido
      };
      escribirArchivoAtomico(rutaPrimaria, JSON.stringify(dataActualizada, null, 2));
    }
  }

  obtenerPrimaria(rolConsultar = this.rol) {
    const coordDir = obtenerRutaCoordinacion(this.repoRoot);
    const rutaPrimaria = path.join(coordDir, 'sesiones', `${rolConsultar}.json`);
    if (!fs.existsSync(rutaPrimaria)) {
      return null;
    }
    try {
      const contenido = fs.readFileSync(rutaPrimaria, 'utf8');
      return JSON.parse(contenido);
    } catch (_) {
      return null;
    }
  }

  estaVencida(sesionData) {
    if (!sesionData || !sesionData.ultimo_latido) return true;
    const diffMs = Date.now() - new Date(sesionData.ultimo_latido).getTime();
    const ttlMs = obtenerTTLMinutos() * 60 * 1000;
    return diffMs > ttlMs;
  }

  esPrimaria() {
    const primaria = this.obtenerPrimaria(this.rol);
    if (!primaria) return false;
    if (primaria.sesion_id !== this.sesionId) return false;
    return !this.estaVencida(primaria);
  }

  designarPrimaria(etiqueta, forzar = false) {
    this.actualizarLatido();
    if (etiqueta && typeof etiqueta === 'string') {
      this.etiqueta = etiqueta.trim();
    }

    const primariaActual = this.obtenerPrimaria(this.rol);
    const coordDir = obtenerRutaCoordinacion(this.repoRoot);
    const rutaPrimaria = path.join(coordDir, 'sesiones', `${this.rol}.json`);

    let accion = 'primaria_establecida';
    let sesionAnterior = null;

    if (primariaActual) {
      sesionAnterior = primariaActual.sesion_id;
      const viva = !this.estaVencida(primariaActual);

      if (primariaActual.sesion_id === this.sesionId) {
        // Ya es la primaria, simplemente actualizar etiqueta
        const data = {
          ...primariaActual,
          etiqueta: this.etiqueta,
          ultimo_latido: this.ultimoLatido
        };
        escribirArchivoAtomico(rutaPrimaria, JSON.stringify(data, null, 2));
        this.registrarSesionActiva();
        return {
          exito: true,
          sesion_id: this.sesionId,
          etiqueta: this.etiqueta,
          mensaje: `Sesión ${this.sesionId} ya era la primaria para el rol ${this.rol}. Etiqueta actualizada a "${this.etiqueta}".`
        };
      }

      if (viva) {
        if (!forzar) {
          throw new Error(
            `No se puede tomar la sesión primaria del rol "${this.rol}" porque ya está asignada a la sesión "${primariaActual.etiqueta}" (${primariaActual.sesion_id}) con latido reciente (${primariaActual.ultimo_latido}). Usa forzar=true si deseas relevarla expresamente.`
          );
        }
        accion = 'forzar_primaria';
        // Registrar alerta para la sesión desbancada
        const dirAlertas = path.join(coordDir, 'sesiones', 'alertas');
        const rutaAlerta = path.join(dirAlertas, `${primariaActual.sesion_id}.json`);
        escribirArchivoAtomico(
          rutaAlerta,
          JSON.stringify({
            cuando: new Date().toISOString(),
            motivo: 'relevo_forzado',
            nueva_sesion_id: this.sesionId,
            nueva_etiqueta: this.etiqueta
          }, null, 2)
        );
      } else {
        accion = 'relevo_primaria_vencida';
      }
    }

    const nuevaData = {
      sesion_id: this.sesionId,
      rol: this.rol,
      etiqueta: this.etiqueta,
      desde: this.desde,
      ultimo_latido: this.ultimoLatido
    };
    escribirArchivoAtomico(rutaPrimaria, JSON.stringify(nuevaData, null, 2));
    this.registrarSesionActiva();

    registrarAuditoria({
      evento: accion,
      rol: this.rol,
      sesion_id: this.sesionId,
      etiqueta: this.etiqueta,
      sesion_anterior: sesionAnterior,
      forzado: forzar
    }, this.repoRoot);

    return {
      exito: true,
      sesion_id: this.sesionId,
      etiqueta: this.etiqueta,
      accion,
      mensaje: `Sesión ${this.sesionId} ("${this.etiqueta}") designada exitosamente como primaria para el rol "${this.rol}".`
    };
  }

  intentarRelevoAutomatico() {
    const primaria = this.obtenerPrimaria(this.rol);
    if (!primaria || this.estaVencida(primaria)) {
      this.designarPrimaria(this.etiqueta, false);
      return true;
    }
    return false;
  }

  comprobarAlertas() {
    const coordDir = obtenerRutaCoordinacion(this.repoRoot);
    const rutaAlerta = path.join(coordDir, 'sesiones', 'alertas', `${this.sesionId}.json`);
    if (fs.existsSync(rutaAlerta)) {
      try {
        const contenido = JSON.parse(fs.readFileSync(rutaAlerta, 'utf8'));
        fs.unlinkSync(rutaAlerta);
        return `AVISO IMPORTANTE: Esta sesión (${this.sesionId}) dejó de ser la primaria porque fue relevada forzosamente por la sesión "${contenido.nueva_etiqueta}" (${contenido.nueva_sesion_id}) el ${contenido.cuando}.`;
      } catch (_) {}
    }
    return null;
  }

  verSesiones() {
    this.actualizarLatido();
    const coordDir = obtenerRutaCoordinacion(this.repoRoot);
    const resultado = {
      mi_sesion: {
        sesion_id: this.sesionId,
        rol: this.rol,
        etiqueta: this.etiqueta,
        es_primaria: this.esPrimaria(),
        ultimo_latido: this.ultimoLatido
      },
      roles: {
        claude: {
          primaria: null,
          secundarias: []
        },
        antigravity: {
          primaria: null,
          secundarias: []
        }
      }
    };

    for (const r of ['claude', 'antigravity']) {
      const p = this.obtenerPrimaria(r);
      if (p) {
        resultado.roles[r].primaria = {
          ...p,
          esta_viva: !this.estaVencida(p)
        };
      }
    }

    const dirActivas = path.join(coordDir, 'sesiones', 'activas');
    if (fs.existsSync(dirActivas)) {
      const archivos = fs.readdirSync(dirActivas);
      for (const arch of archivos) {
        if (!arch.endsWith('.json')) continue;
        try {
          const sesion = JSON.parse(fs.readFileSync(path.join(dirActivas, arch), 'utf8'));
          const esPrimariaActual = resultado.roles[sesion.rol]?.primaria?.sesion_id === sesion.sesion_id;
          if (!esPrimariaActual && resultado.roles[sesion.rol]) {
            resultado.roles[sesion.rol].secundarias.push({
              ...sesion,
              esta_viva: !this.estaVencida(sesion)
            });
          }
        } catch (_) {}
      }
    }

    return resultado;
  }
}
