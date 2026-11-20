import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

function crearClienteMCPStdio(env) {
  const rutaServidor = path.resolve('src/servidor.js');
  const hijo = spawn('node', [rutaServidor], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'inherit']
  });

  const rl = readline.createInterface({ input: hijo.stdout });
  let reqId = 1;
  const pendientes = new Map();

  rl.on('line', (linea) => {
    if (!linea.trim()) return;
    try {
      const msg = JSON.parse(linea);
      if (msg.id && pendientes.has(msg.id)) {
        const { resolve } = pendientes.get(msg.id);
        pendientes.delete(msg.id);
        resolve(msg);
      }
    } catch (_) {}
  });

  function enviarPeticion(metodo, params = {}) {
    return new Promise((resolve, reject) => {
      const id = reqId++;
      pendientes.set(id, { resolve, reject });
      const mensaje = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: metodo,
        params
      }) + '\n';
      hijo.stdin.write(mensaje);
    });
  }

  function enviarNotificacion(metodo, params = {}) {
    const mensaje = JSON.stringify({
      jsonrpc: '2.0',
      method: metodo,
      params
    }) + '\n';
    hijo.stdin.write(mensaje);
  }

  function cerrar() {
    hijo.kill();
  }

  return { hijo, enviarPeticion, enviarNotificacion, cerrar };
}

test('Protocolo MCP: ciclo de vida completo JSON-RPC por stdio (initialize -> tools/list -> tools/call)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-proto-'));
  const cliente = crearClienteMCPStdio({
    BUZON_YO: 'claude',
    BUZON_RAIZ: tmpDir
  });

  try {
    // 1. initialize
    const initRes = await cliente.enviarPeticion('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    });

    assert.ok(initRes.result);
    assert.equal(initRes.result.serverInfo.name, 'buzon-coordinacion');
    assert.ok(initRes.result.capabilities.tools);

    cliente.enviarNotificacion('notifications/initialized');

    // 2. tools/list
    const listRes = await cliente.enviarPeticion('tools/list');
    assert.ok(listRes.result);
    const nombresHerramientas = listRes.result.tools.map(t => t.name);
    const esperadas = [
      'enviar_mensaje',
      'leer_buzon',
      'marcar_leido',
      'estado_tarea',
      'listar_tareas',
      'designar_primaria',
      'ver_sesiones',
      'estado_buzon'
    ];
    for (const esp of esperadas) {
      assert.ok(nombresHerramientas.includes(esp), `Falta la herramienta ${esp}`);
    }

    // 3. tools/call -> designar_primaria
    const callPrimaria = await cliente.enviarPeticion('tools/call', {
      name: 'designar_primaria',
      arguments: { etiqueta: 'coordinador-test' }
    });
    assert.ok(callPrimaria.result);
    assert.equal(callPrimaria.result.isError, undefined);
    assert.match(callPrimaria.result.content[0].text, /designada exitosamente como primaria/);

    // 4. tools/call -> enviar_mensaje
    const callEnvio = await cliente.enviarPeticion('tools/call', {
      name: 'enviar_mensaje',
      arguments: {
        para: 'antigravity',
        asunto: 'Mensaje por protocolo',
        cuerpo: 'Probando MCP stdio'
      }
    });
    assert.ok(callEnvio.result);
    assert.equal(callEnvio.result.isError, undefined);
    assert.match(callEnvio.result.content[0].text, /"de": "claude"/);
    assert.match(callEnvio.result.content[0].text, /"para": "antigravity"/);

    // 5. tools/call -> estado_tarea con estado protegido (debe devolver isError: true)
    const callProtegido = await cliente.enviarPeticion('tools/call', {
      name: 'estado_tarea',
      arguments: {
        tarea: 'f1-test',
        estado: 'MIGRACION_APLICADA'
      }
    });
    assert.ok(callProtegido.result);
    assert.equal(callProtegido.result.isError, true);
    assert.match(callProtegido.result.content[0].text, /es PROTEGIDO/);

    // 6. tools/call -> parámetros inválidos (ej. enviar sin cuerpo)
    const callInvalido = await cliente.enviarPeticion('tools/call', {
      name: 'enviar_mensaje',
      arguments: {
        para: 'antigravity',
        asunto: 'Sin cuerpo'
      }
    });
    assert.ok(callInvalido.result);
    assert.equal(callInvalido.result.isError, true);
    assert.match(callInvalido.result.content[0].text, /cuerpo del mensaje es obligatorio/);

  } finally {
    cliente.cerrar();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
