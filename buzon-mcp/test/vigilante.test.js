import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GestorSesiones } from '../src/sesiones.js';
import { enviarMensaje } from '../src/almacen.js';
import {
  VigilanteMotor,
  PROMPT_FIJO,
  MAX_INVOCACIONES_HORA
} from '../scripts/vigilante.js';

test('Vigilante: despierta al rol destino ante mensajes nuevos y usa prompt fijo', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-vigilante-'));
  try {
    const claude = new GestorSesiones({ rol: 'claude', repoRoot: tmpDir, etiqueta: 'coord' });
    claude.designarPrimaria('coord');

    // Enviar un mensaje de claude a antigravity
    const envio = enviarMensaje({
      gestorSesion: claude,
      para: 'antigravity',
      asunto: 'Instrucción vigilada',
      cuerpo: 'Trabajo para antigravity'
    });

    const invocaciones = [];
    const mockEjecutor = async (rol) => {
      invocaciones.push({ rol });
      return { codigo: 0, timeout: false };
    };

    const vigilante = new VigilanteMotor({
      repoRoot: tmpDir,
      ejecutorProceso: mockEjecutor
    });

    await vigilante.revisarCiclo();

    assert.equal(invocaciones.length, 1);
    assert.equal(invocaciones[0].rol, 'antigravity');

    // Comprobar que en el segundo ciclo no vuelve a invocar por el mismo mensaje
    await vigilante.revisarCiclo();
    assert.equal(invocaciones.length, 1, 'No debe invocar dos veces por el mismo mensaje');

    // Verificar prompt fijo
    assert.match(PROMPT_FIJO, /Hay mensajes nuevos en tu buzón/);
    assert.match(PROMPT_FIJO, /No apruebes migraciones, verify ni despliegues/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Vigilante: tope de 6 invocaciones por hora detiene el vigilante y registra en audit.log', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-vigilante-'));
  try {
    const claude = new GestorSesiones({ rol: 'claude', repoRoot: tmpDir, etiqueta: 'coord' });
    claude.designarPrimaria('coord');

    let contadorInvocaciones = 0;
    const mockEjecutor = async () => {
      contadorInvocaciones++;
      return { codigo: 0, timeout: false };
    };

    const vigilante = new VigilanteMotor({
      repoRoot: tmpDir,
      ejecutorProceso: mockEjecutor
    });

    // Simular estado previo con 6 invocaciones en la última media hora
    const ahora = Date.now();
    const estadoSimulado = {
      invocaciones: Array.from({ length: MAX_INVOCACIONES_HORA }, (_, i) => ahora - i * 60 * 1000),
      mensajes_notificados: []
    };
    vigilante.guardarEstado(estadoSimulado);

    // Enviar mensaje nuevo
    enviarMensaje({
      gestorSesion: claude,
      para: 'antigravity',
      asunto: 'Mensaje después del tope',
      cuerpo: 'Este mensaje no debe provocar invocación'
    });

    await vigilante.revisarCiclo();

    // No debe haber invocado al proceso
    assert.equal(contadorInvocaciones, 0);
    assert.equal(vigilante.detenido, true, 'El vigilante debe haberse detenido al alcanzar el tope');

    // Verificar que quedó registrado en audit.log
    const auditPath = path.join(tmpDir, 'docs', 'coordinacion', 'audit.log');
    assert.ok(fs.existsSync(auditPath));
    const lineas = fs.readFileSync(auditPath, 'utf8').trim().split('\n');
    const entradaTope = lineas.map(l => JSON.parse(l)).find(e => e.evento === 'vigilante_tope_alcanzado');
    assert.ok(entradaTope);
    assert.match(entradaTope.motivo, /Tope horario alcanzado/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
