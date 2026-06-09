/**
 * ecosystem.config.cjs — PM2 configuration for Portería Virtual
 *
 * Hostinger Node.js hosting uses PM2 to gestionar el proceso.
 * Las variables de entorno sensibles (DAHUA_PASS, serviceAccountKey) se
 * configuran en el panel de Hostinger, NO aquí.
 *
 * Panel Hostinger → Node.js → Environment Variables:
 *   PORT              (asignado por Hostinger automáticamente)
 *   DAHUA_HOST        https://vdp.porteriavirtual.cl
 *   DAHUA_USER        api
 *   DAHUA_PASS        <contraseña real>
 */

module.exports = {
  apps: [
    {
      name: 'porteria-virtual',
      script: 'server.cjs',

      // PM2 reinicia automáticamente si el proceso cae
      autorestart: true,
      watch: false,          // no usar watch en producción
      max_memory_restart: '1G',

      // Logs
      out_file: './logs/out.log',
      error_file: './logs/err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // Variables de entorno de producción
      // Las sensibles (DAHUA_PASS) se inyectan desde el panel de Hostinger
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
