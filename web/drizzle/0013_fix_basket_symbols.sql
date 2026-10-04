-- Corporate-action renames: the baskets pointed at tickers Angel One no longer lists, so these
-- constituents had no price history. Idempotent: rows that already use the new ticker are left as
-- they are, and a basket that ends up with the new ticker twice keeps the first occurrence.
--   AGREVOIND -> BAYERCROP, SPEL -> SPELS, AMIORG -> ACUTAAS, TATAMOTORS -> TMPV
UPDATE valuation.sector_baskets b
SET symbols = (
    SELECT jsonb_agg(s ORDER BY first_pos)
    FROM (
        SELECT s, min(pos) AS first_pos
        FROM (
            SELECT CASE t.s
                       WHEN 'AGREVOIND' THEN 'BAYERCROP'
                       WHEN 'SPEL' THEN 'SPELS'
                       WHEN 'AMIORG' THEN 'ACUTAAS'
                       WHEN 'TATAMOTORS' THEN 'TMPV'
                       ELSE t.s
                   END AS s,
                   t.pos
            FROM jsonb_array_elements_text(b.symbols) WITH ORDINALITY AS t(s, pos)
        ) mapped
        GROUP BY s
    ) deduped
)
WHERE b.symbols ?| ARRAY['AGREVOIND', 'SPEL', 'AMIORG', 'TATAMOTORS'];
