import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

function crearClienteMCP(rol, repoRoot) {
  const rutaServidor = path.resolve('src/servidor.js');
  const hijo = spawn('node', [rutaServidor], {
    env: { ...process.env, BUZON_YO: rol, BUZON_RAIZ: repoRoot },
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

  function call(method, params = {}) {
    return new Promise((resolve) => {
      const id = reqId++;
      pendientes.set(id, { resolve });
      hijo.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  function notify(method, params = {}) {
    hijo.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async function callTool(name, args = {}) {
    const res = await call('tools/call', { name, arguments: args });
    return res.result;
  }

  return { hijo, call, notify, callTool, kill: () => hijo.kill() };
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-e2e-'));
  console.log(`[E2E] Directorio de prueba: ${tmpDir}`);

  const claude = crearClienteMCP('claude', tmpDir);
  const antigravity = crearClienteMCP('antigravity', tmpDir);

  try {
    // 1. Initialize ambos
    await claude.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.1.169' } });
    claude.notify('notifications/initialized');

    await antigravity.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'antigravity-ide', version: '1.5.13' } });
    antigravity.notify('notifications/initialized');

    // 2. Designar primarias
    console.log('\n--- 1. DESIGNANDO SESIONES PRIMARIAS ---');
    const pClaude = await claude.callTool('designar_primaria', { etiqueta: 'coordinador' });
    console.log('Claude designar_primaria:', pClaude.content[0].text);

    const pAg = await antigravity.callTool('designar_primaria', { etiqueta: 'constructor-f2' });
    console.log('Antigravity designar_primaria:', pAg.content[0].text);

    // 3. Ver sesiones mostrando ambos
    console.log('\n--- 2. VER SESIONES (AMBOS ROLES CON LATIDO) ---');
    const sesiones = await claude.callTool('ver_sesiones', {});
    console.log('ver_sesiones:', sesiones.content[0].text);

    // 4. Claude envía instrucción a Antigravity
    console.log('\n--- 3. CLAUDE ENVÍA MENSAJE A ANTIGRAVITY ---');
    const envio1 = await claude.callTool('enviar_mensaje', {
      para: 'antigravity',
      asunto: 'Ronda 4: correcciones de la épica 2',
      tipo: 'instruccion',
      tarea: 'f2-mantenimiento',
      cuerpo: 'Por favor ajusta los tests de la sesión y verifica el timeout de conexión.',
      archivos: ['docs/reports/REVISION_EPICA2_F2.md']
    });
    console.log('Claude enviar_mensaje:', envio1.content[0].text);
    const envio1Data = JSON.parse(envio1.content[0].text);

    // 5. Antigravity lee buzón con reclamar=true
    console.log('\n--- 4. ANTIGRAVITY LEE BUZÓN (RECLAMANDO LEASE) ---');
    const buzonAg = await antigravity.callTool('leer_buzon', { solo_no_leidos: true, reclamar: true });
    console.log('Antigravity leer_buzon:', buzonAg.content[0].text);

    // 6. Antigravity marca como leído
    console.log('\n--- 5. ANTIGRAVITY MARCA LEÍDO ---');
    const leidoAg = await antigravity.callTool('marcar_leido', { id: envio1Data.id });
    console.log('Antigravity marcar_leido:', leidoAg.content[0].text);

    // 7. Antigravity actualiza estado de tarea
    console.log('\n--- 6. ANTIGRAVITY ACTUALIZA ESTADO DE TAREA ---');
    const estadoT = await antigravity.callTool('estado_tarea', {
      tarea: 'f2-mantenimiento',
      estado: 'PENDIENTE_REVISION',
      nota: 'Correcciones implementadas. Listo para revisión de Claude.'
    });
    console.log('Antigravity estado_tarea:', estadoT.content[0].text);

    // 8. Antigravity envía reporte de respuesta
    console.log('\n--- 7. ANTIGRAVITY RESPONDE A CLAUDE ---');
    const respAg = await antigravity.callTool('enviar_mensaje', {
      para: 'claude',
      asunto: 'Reporte Ronda 4: correcciones listas',
      tipo: 'reporte',
      tarea: 'f2-mantenimiento',
      cuerpo: 'Se ejecutaron los tests unitarios con 100% de éxito y se verificó el timeout.',
      responde_a: envio1Data.id
    });
    console.log('Antigravity enviar_mensaje (respuesta):', respAg.content[0].text);
    const respAgData = JSON.parse(respAg.content[0].text);

    // 9. Claude lee buzón y ve la respuesta
    console.log('\n--- 8. CLAUDE LEE BUZÓN Y RECIBE EL REPORTE ---');
    const buzonClaude = await claude.callTool('leer_buzon', { solo_no_leidos: true, reclamar: true });
    console.log('Claude leer_buzon:', buzonClaude.content[0].text);

    // 10. Claude marca como leído
    const leidoClaude = await claude.callTool('marcar_leido', { id: respAgData.id });
    console.log('Claude marcar_leido:', leidoClaude.content[0].text);

    // 11. Estado del buzón final
    console.log('\n--- 9. ESTADO DEL BUZÓN FINAL ---');
    const estadoFinal = await claude.callTool('estado_buzon', {});
    console.log('estado_buzon:', estadoFinal.content[0].text);

    console.log('\n[E2E EXITOSO] Todos los pasos del ciclo real completados sin errores.');
  } finally {
    claude.kill();
    antigravity.kill();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('[E2E ERROR]', err);
  process.exit(1);
});
