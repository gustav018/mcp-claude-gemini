import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validarLimitesYSecretos,
  MAX_CUERPO_BYTES,
  MAX_ASUNTO_CHARS,
  MAX_ARCHIVOS_ADJUNTOS
} from '../src/filtro.js';

test('Filtro: límites de cuerpo (20 KB vs 20 KB + 1)', () => {
  const cuerpoExacto20KB = 'a'.repeat(MAX_CUERPO_BYTES);
  const resultado = validarLimitesYSecretos({
    asunto: 'Asunto válido',
    cuerpo: cuerpoExacto20KB
  });
  assert.equal(resultado.bytesCuerpo, MAX_CUERPO_BYTES);

  const cuerpoExcedido = 'a'.repeat(MAX_CUERPO_BYTES + 1);
  assert.throws(() => {
    validarLimitesYSecretos({
      asunto: 'Asunto válido',
      cuerpo: cuerpoExcedido
    });
  }, /excede el límite de 20480 bytes/);
});

test('Filtro: límites de asunto (200 caracteres vs 201)', () => {
  const asunto200 = 'x'.repeat(MAX_ASUNTO_CHARS);
  const resultado = validarLimitesYSecretos({
    asunto: asunto200,
    cuerpo: 'cuerpo válido'
  });
  assert.equal(resultado.asunto.length, 200);

  const asunto201 = 'x'.repeat(MAX_ASUNTO_CHARS + 1);
  assert.throws(() => {
    validarLimitesYSecretos({
      asunto: asunto201,
      cuerpo: 'cuerpo válido'
    });
  }, /excede el límite máximo de 200 caracteres/);
});

test('Filtro: límites de archivos adjuntos (10 vs 11)', () => {
  const diezArchivos = Array.from({ length: MAX_ARCHIVOS_ADJUNTOS }, (_, i) => `doc/f${i}.md`);
  const resultado = validarLimitesYSecretos({
    asunto: 'Asunto válido',
    cuerpo: 'cuerpo válido',
    archivos: diezArchivos
  });
  assert.equal(resultado.archivos.length, 10);

  const onceArchivos = Array.from({ length: MAX_ARCHIVOS_ADJUNTOS + 1 }, (_, i) => `doc/f${i}.md`);
  assert.throws(() => {
    validarLimitesYSecretos({
      asunto: 'Asunto válido',
      cuerpo: 'cuerpo válido',
      archivos: onceArchivos
    });
  }, /No se permiten más de 10 archivos/);
});

test('Filtro: detección de cada patrón de secretos y no repite el valor en el error', () => {
  const casosSecretos = [
    { patron: 'PostgreSQL URI', secreto: 'postgres://user:super_secret_pass_123@localhost:5432/db' },
    { patron: 'PostgreSQL alternative URI', secreto: 'postgresql://dbadmin:mypassword999@aws.com:5432/db' },
    { patron: 'JWT', secreto: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c' },
    { patron: 'service_role', secreto: 'Clave con rol service_role de supabase' },
    { patron: 'Private Key', secreto: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----' },
    { patron: 'Google API Key', secreto: 'AI' + 'zaSyA_89234729384729348729384' },
    { patron: 'OpenAI/Anthropic sk-', secreto: 's' + 'k-ant-api03-abcdef1234567890abcdef1234567890' },
    { patron: 'GitHub token', secreto: 'gh' + 'p_1234567890abcdefghijklmnopqrstuvwxyz' },
    { patron: 'Slack token', secreto: 'xox' + 'b-1234567890-dummy-slack-token-test' },
    { patron: 'Password key-value', secreto: 'password: miClaveSuperSecretaDe16Caracteres' },
    { patron: 'Token key-value', secreto: 'token=miTokenSuperSecretoDe20Caracteres' },
    { patron: 'Clave key-value', secreto: 'clave = estaEsUnaClaveLargaSecreta' }
  ];

  for (const caso of casosSecretos) {
    let errorCapturado = null;
    try {
      validarLimitesYSecretos({
        asunto: 'Prueba de secretos',
        cuerpo: `Contenido que incluye ${caso.secreto} en el cuerpo`
      });
    } catch (err) {
      errorCapturado = err;
    }

    assert.ok(errorCapturado, `Debe rechazar el secreto: ${caso.patron}`);
    assert.match(errorCapturado.message, /Filtro de seguridad: se detectó un patrón de secreto prohibido/);
    // Verificar que el valor del secreto NO se repite en el mensaje de error
    assert.equal(
      errorCapturado.message.includes(caso.secreto),
      false,
      `El mensaje de error no debe contener el valor del secreto: ${caso.secreto}`
    );
  }
});
