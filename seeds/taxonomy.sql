-- Starter taxonomy. Controlled per BUILD_PLAN.md §1.5 — new niches go through
-- POST /taxonomy/niches, not free text. Broad industries are managed here.
INSERT INTO broad_industries (name) VALUES
    ('Auto & Mobility'),
    ('IT Services'),
    ('Financial Services'),
    ('Consumer Retail'),
    ('Software & SaaS')
ON CONFLICT (name) DO NOTHING;

INSERT INTO specific_niches (broad_industry_id, name)
SELECT id, niche FROM broad_industries, (VALUES
    ('Auto & Mobility', 'Precision Forged & Machined Components'),
    ('Auto & Mobility', 'Auto Ancillaries'),
    ('IT Services', 'IT Consulting & Staffing'),
    ('Financial Services', 'NBFC Lending'),
    ('Consumer Retail', 'Specialty Retail Chains'),
    ('Software & SaaS', 'Vertical SaaS')
) AS t(industry, niche)
WHERE broad_industries.name = t.industry
ON CONFLICT (broad_industry_id, name) DO NOTHING;
