-- Nueva columna real en el Excel EETT de producción ("ANEXO RepLeg (GC)") no
-- mapeada: anexo firmado por el representante legal, pedido por generadores
-- de carga (Walmart) — mismo patrón que anexo_2_gc, solo que para el rep.
-- legal en vez de la empresa. Ver centralizer_parser.py EMPRESAS_COLUMNS.
INSERT INTO app.compliance_doc_catalog (doc_code, entity_type, label, sort_order, required_for_clients)
VALUES ('anexo_repleg_gc', 'transporter', 'Anexo representante legal (gran cuenta)', 25, ARRAY['Walmart']);
