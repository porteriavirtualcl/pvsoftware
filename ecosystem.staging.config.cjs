/**
 * ecosystem.staging.cjs — ambiente de PRUEBAS (mismo VPS que producción, otro puerto y otro Firebase).
 * Se despliega en /var/www/pvsoftware-staging desde la rama `staging`. Su .env define JOBS_ENABLED=0,
 * su propio FIREBASE_SERVICE_ACCOUNT_B64 y una central SIP en otro puerto. Nunca lleva DAHUA_*
 * de producción (una segunda sesión del DSS expulsa al sincronizador real).
 */
module.exports = {
  apps: [{
    name: 'porteria-staging',
    script: 'server.cjs',
    autorestart: true,
    watch: false,
    max_memory_restart: '600M',
    out_file: './logs/out.log',
    error_file: './logs/err.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    env: { NODE_ENV: 'production', PORT: 3002 },
  }],
};
