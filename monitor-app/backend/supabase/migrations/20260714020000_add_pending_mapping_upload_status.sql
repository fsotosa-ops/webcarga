-- Bug real encontrado en uso: app.centralizer_uploads.status es un ENUM
-- (app.upload_status), no texto libre — el nuevo status 'pending_mapping'
-- (mapeo self-service de columnas) nunca se agregó al enum, causando un 500
-- sin capturar en cualquier upload con columnas sin resolver.
ALTER TYPE app.upload_status ADD VALUE 'pending_mapping';
