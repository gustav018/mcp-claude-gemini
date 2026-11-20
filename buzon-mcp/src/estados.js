export const ESTADOS_PERMITIDOS_MCP = Object.freeze([
  'EN_PROGRESO',
  'BLOQUEADO',
  'PENDIENTE_REVISION',
  'REQUIERE_DECISION_HUMANA'
]);

export const ESTADOS_PROTEGIDOS = Object.freeze([
  'MIGRACION_APLICADA',
  'VERIFY_APROBADO',
  'DESPLEGADO_PROD',
  'APROBADO_POR_GUSTAVO'
]);

export const TODOS_LOS_ESTADOS = Object.freeze([
  ...ESTADOS_PERMITIDOS_MCP,
  ...ESTADOS_PROTEGIDOS
]);

export function validarEstadoMCP(estado) {
  if (!estado || typeof estado !== 'string') {
    throw new Error('El estado es obligatorio y debe ser una cadena.');
  }

  const estadoNormalizado = estado.trim().toUpperCase();

  if (ESTADOS_PROTEGIDOS.includes(estadoNormalizado)) {
    throw new Error(
      `Acción rechazada: el estado "${estadoNormalizado}" es PROTEGIDO y no puede ser modificado por ninguna IA mediante MCP. Requiere aprobación humana expresa de Gustavo ejecutando scripts/aprobar.js.`
    );
  }

  if (!ESTADOS_PERMITIDOS_MCP.includes(estadoNormalizado)) {
    throw new Error(
      `Estado inválido: "${estadoNormalizado}". Estados permitidos para IA: ${ESTADOS_PERMITIDOS_MCP.join(', ')}.`
    );
  }

  return estadoNormalizado;
}

export function validarEstadoHumano(estado) {
  if (!estado || typeof estado !== 'string') {
    throw new Error('El estado es obligatorio y debe ser una cadena.');
  }

  const estadoNormalizado = estado.trim().toUpperCase();

  if (!TODOS_LOS_ESTADOS.includes(estadoNormalizado)) {
    throw new Error(
      `Estado inválido: "${estadoNormalizado}". Estados válidos disponibles: ${TODOS_LOS_ESTADOS.join(', ')}.`
    );
  }

  return estadoNormalizado;
}
