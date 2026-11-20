export const PATRONES_SECRETOS = [
  { nombre: 'URI PostgreSQL (postgres(ql)?://)', regex: /postgres(?:ql)?:\/\//i },
  { nombre: 'JWT (eyJ...)', regex: /eyJ[A-Za-z0-9_-]{10,}\./ },
  { nombre: 'Supabase service_role', regex: /service_role/i },
  { nombre: 'Clave privada (-----BEGIN ... PRIVATE KEY-----)', regex: /-----BEGIN .* PRIVATE KEY-----/ },
  { nombre: 'Google API Key (AIza...)', regex: /AIza[0-9A-Za-z_-]{20,}/ },
  { nombre: 'API Key (sk-...)', regex: /sk-[A-Za-z0-9_-]{20,}/ },
  { nombre: 'GitHub Personal Access Token (ghp_...)', regex: /ghp_[A-Za-z0-9]{20,}/ },
  { nombre: 'Slack Token (xox[abp]-)', regex: /xox[abp]-/i },
  { nombre: 'Asignación de secreto/token/password/clave', regex: /(?:secret|token|password|clave)\s*[:=]\s*\S{12,}/i }
];

export const MAX_CUERPO_BYTES = 20 * 1024; // 20 KB (20480 bytes)
export const MAX_ASUNTO_CHARS = 200;
export const MAX_ARCHIVOS_ADJUNTOS = 10;

export function detectarSecreto(texto) {
  if (typeof texto !== 'string') return null;
  for (const item of PATRONES_SECRETOS) {
    if (item.regex.test(texto)) {
      return item.nombre;
    }
  }
  return null;
}

export function validarLimitesYSecretos({ asunto, cuerpo, archivos = [] }) {
  // Validación de tipos básicos
  if (typeof asunto !== 'string' || asunto.trim() === '') {
    throw new Error('El asunto es obligatorio y no puede estar vacío.');
  }
  if (asunto.length > MAX_ASUNTO_CHARS) {
    throw new Error(`El asunto excede el límite máximo de ${MAX_ASUNTO_CHARS} caracteres (longitud actual: ${asunto.length}).`);
  }

  if (typeof cuerpo !== 'string' || cuerpo.trim() === '') {
    throw new Error('El cuerpo del mensaje es obligatorio y no puede estar vacío.');
  }
  const bytesCuerpo = Buffer.byteLength(cuerpo, 'utf8');
  if (bytesCuerpo > MAX_CUERPO_BYTES) {
    throw new Error(`El cuerpo excede el límite de ${MAX_CUERPO_BYTES} bytes (20 KB). Tamaño actual: ${bytesCuerpo} bytes.`);
  }

  if (!Array.isArray(archivos)) {
    throw new Error('El parámetro archivos debe ser un arreglo de cadenas.');
  }
  if (archivos.length > MAX_ARCHIVOS_ADJUNTOS) {
    throw new Error(`No se permiten más de ${MAX_ARCHIVOS_ADJUNTOS} archivos adjuntos (se proporcionaron ${archivos.length}).`);
  }

  // Comprobar filtro de secretos en asunto
  const secretoEnAsunto = detectarSecreto(asunto);
  if (secretoEnAsunto) {
    throw new Error(`Filtro de seguridad: se detectó un patrón de secreto prohibido en el asunto [${secretoEnAsunto}]. El valor confidencial fue omitido.`);
  }

  // Comprobar filtro de secretos en cuerpo
  const secretoEnCuerpo = detectarSecreto(cuerpo);
  if (secretoEnCuerpo) {
    throw new Error(`Filtro de seguridad: se detectó un patrón de secreto prohibido en el cuerpo [${secretoEnCuerpo}]. El valor confidencial fue omitido.`);
  }

  // Comprobar filtro de secretos en nombres/rutas de archivos adjuntos
  for (const archivo of archivos) {
    const secretoEnArchivo = detectarSecreto(archivo);
    if (secretoEnArchivo) {
      throw new Error(`Filtro de seguridad: se detectó un patrón de secreto prohibido en la ruta de adjunto [${secretoEnArchivo}]. El valor confidencial fue omitido.`);
    }
  }

  return {
    asunto,
    cuerpo,
    archivos,
    bytesCuerpo
  };
}
