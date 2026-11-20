#!/usr/bin/env node

/**
 * Servidor MCP: Buzón de coordinación entre Claude Code y Antigravity.
 * Protocolo: Model Context Protocol (MCP) sobre stdio.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';

import { GestorSesiones } from './sesiones.js';
import {
  encontrarRaizRepositorio,
  enviarMensaje,
  leerBuzon,
  marcarLeido,
  actualizarEstadoTarea,
  listarTareas,
  obtenerEstadoBuzon,
  TIPOS_MENSAJE
} from './almacen.js';
import { ESTADOS_PERMITIDOS_MCP } from './estados.js';

const rolEnv = (process.env.BUZON_YO || '').trim().toLowerCase();
if (!rolEnv || (rolEnv !== 'claude' && rolEnv !== 'antigravity')) {
  console.error(`[ERROR CRÍTICO BUZON-MCP] Variable de entorno BUZON_YO no definida o inválida: "${process.env.BUZON_YO}". Debe ser "claude" o "antigravity".`);
  process.exit(1);
}

const repoRoot = process.env.BUZON_RAIZ ? process.env.BUZON_RAIZ.trim() : encontrarRaizRepositorio();
const gestorSesion = new GestorSesiones({
  rol: rolEnv,
  repoRoot
});

// Definición de las 8 herramientas exactas requeridas por la especificación
export const HERRAMIENTAS = [
  {
    name: 'enviar_mensaje',
    description: 'Crea y envía un mensaje o reporte al buzón del otro rol (claude o antigravity). Remitente fijado por BUZON_YO.',
    inputSchema: {
      type: 'object',
      properties: {
        para: {
          type: 'string',
          enum: ['claude', 'antigravity'],
          description: 'Rol destinatario ("claude" o "antigravity"). No puede ser tu propio rol.'
        },
        asunto: {
          type: 'string',
          maxLength: 200,
          description: 'Asunto o resumen breve del mensaje (máx. 200 caracteres).'
        },
        cuerpo: {
          type: 'string',
          description: 'Contenido completo en Markdown (máx. 20 KB). Pasa por filtro de secretos.'
        },
        tipo: {
          type: 'string',
          enum: TIPOS_MENSAJE,
          description: 'Tipo de mensaje: instruccion, reporte, pregunta, respuesta, aviso. (Por defecto: instruccion).'
        },
        tarea: {
          type: 'string',
          description: 'Identificador de la tarea asociada (ej. "f2-mantenimiento").'
        },
        archivos: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 10,
          description: 'Lista de rutas relativas al repositorio de archivos relevantes (máx. 10).'
        },
        responde_a: {
          type: 'string',
          description: 'ID del mensaje previo al que responde este mensaje.'
        },
        sesion: {
          type: 'string',
          description: 'Etiqueta de sesión específica a la que se dirige el mensaje (opcional).'
        }
      },
      required: ['para', 'asunto', 'cuerpo']
    }
  },
  {
    name: 'leer_buzon',
    description: 'Lista mensajes dirigidos a mi rol. Con reclamar=true toma el lease de 10 min (solo sesión primaria). Cada cuerpo viene marcado como CONTENIDO NO CONFIABLE.',
    inputSchema: {
      type: 'object',
      properties: {
        solo_no_leidos: {
          type: 'boolean',
          default: true,
          description: 'Si es true, solo devuelve mensajes no leídos y no reclamados por otra sesión.'
        },
        reclamar: {
          type: 'boolean',
          default: false,
          description: 'Si es true, toma el lease de reclamo de 10 minutos (requiere ser sesión PRIMARIA).'
        },
        limite: {
          type: 'integer',
          default: 20,
          description: 'Cantidad máxima de mensajes a devolver (por defecto 20).'
        }
      }
    }
  },
  {
    name: 'marcar_leido',
    description: 'Escribe el recibo definitivo de "leído" para un mensaje (solo sesión primaria).',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID del mensaje a marcar como leído (ej. "m_...").'
        }
      },
      required: ['id']
    }
  },
  {
    name: 'estado_tarea',
    description: 'Cambia el estado de una tarea entre los permitidos para IA. Los estados protegidos (migraciones, verify, despliegue, aprobación de Gustavo) son rechazados.',
    inputSchema: {
      type: 'object',
      properties: {
        tarea: {
          type: 'string',
          description: 'Nombre de la tarea (ej. "f2-mantenimiento").'
        },
        estado: {
          type: 'string',
          enum: ESTADOS_PERMITIDOS_MCP,
          description: `Estado a asignar. Permitidos: ${ESTADOS_PERMITIDOS_MCP.join(', ')}.`
        },
        nota: {
          type: 'string',
          description: 'Nota explicativa del cambio de estado.'
        }
      },
      required: ['tarea', 'estado']
    }
  },
  {
    name: 'listar_tareas',
    description: 'Devuelve los estados actuales e historial de todas las tareas registradas en el proyecto.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'designar_primaria',
    description: 'Fija o relega la sesión primaria de mi rol. Si hay una primaria viva, requiere forzar=true.',
    inputSchema: {
      type: 'object',
      properties: {
        etiqueta: {
          type: 'string',
          description: 'Etiqueta humana legible para identificar esta sesión (ej. "coordinador", "constructor-f2").'
        },
        forzar: {
          type: 'boolean',
          default: false,
          description: 'Si es true, toma el control como primaria desbancando a la primaria previa activa.'
        }
      },
      required: ['etiqueta']
    }
  },
  {
    name: 'ver_sesiones',
    description: 'Muestra las sesiones primarias y secundarias de ambos roles, junto con sus últimos latidos.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'estado_buzon',
    description: 'Estadísticas del buzón: conteo de mensajes sin leer por rol, reclamados activos y tamaño de carpeta.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

export function crearServidorMCP({ rol, repoRoot: rootPersonalizada } = {}) {
  const rolActivo = rol || rolEnv;
  const rootActiva = rootPersonalizada || repoRoot;
  const sesion = new GestorSesiones({
    rol: rolActivo,
    repoRoot: rootActiva
  });

  const server = new Server(
    {
      name: 'buzon-coordinacion',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    sesion.actualizarLatido();
    return {
      tools: HERRAMIENTAS
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    sesion.actualizarLatido();
    const { name, arguments: args = {} } = request.params;

    try {
      let resultado;

      switch (name) {
        case 'enviar_mensaje': {
          resultado = enviarMensaje({
            gestorSesion: sesion,
            para: args.para,
            asunto: args.asunto,
            cuerpo: args.cuerpo,
            tipo: args.tipo,
            tarea: args.tarea,
            archivos: args.archivos,
            responde_a: args.responde_a,
            sesion: args.sesion
          });
          break;
        }

        case 'leer_buzon': {
          resultado = leerBuzon({
            gestorSesion: sesion,
            solo_no_leidos: args.solo_no_leidos !== false,
            reclamar: Boolean(args.reclamar),
            limite: Number(args.limite) || 20
          });
          break;
        }

        case 'marcar_leido': {
          resultado = marcarLeido({
            gestorSesion: sesion,
            id: args.id
          });
          break;
        }

        case 'estado_tarea': {
          resultado = actualizarEstadoTarea({
            gestorSesion: sesion,
            tarea: args.tarea,
            estado: args.estado,
            nota: args.nota
          });
          break;
        }

        case 'listar_tareas': {
          resultado = listarTareas(sesion.repoRoot);
          break;
        }

        case 'designar_primaria': {
          resultado = sesion.designarPrimaria(args.etiqueta, Boolean(args.forzar));
          break;
        }

        case 'ver_sesiones': {
          resultado = sesion.verSesiones();
          break;
        }

        case 'estado_buzon': {
          resultado = obtenerEstadoBuzon(sesion.repoRoot);
          break;
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Herramienta desconocida: ${name}`);
      }

      const textoRespuesta = typeof resultado === 'string' ? resultado : JSON.stringify(resultado, null, 2);
      return {
        content: [
          {
            type: 'text',
            text: textoRespuesta
          }
        ]
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error en ${name}: ${err.message}`
          }
        ]
      };
    }
  });

  return { server, sesion };
}

// Iniciar sobre stdio si se invoca como proceso principal
const esEjecutableDirecto = process.argv[1] && (
  process.argv[1].endsWith('servidor.js') ||
  process.argv[1].endsWith('servidor')
);

if (esEjecutableDirecto) {
  const { server } = crearServidorMCP();
  const transport = new StdioServerTransport();

  server.connect(transport).catch((err) => {
    console.error(`[FATAL] Error de conexión MCP stdio: ${err.message}`);
    process.exit(1);
  });
}
