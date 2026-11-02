CREATE TABLE IF NOT EXISTS public.thesis_images (
 id bigserial PRIMARY KEY,
 scenario_id bigint NOT NULL REFERENCES public.thesis_scenarios(id) ON DELETE CASCADE,
 title varchar(120) NOT NULL,
 category varchar(30) NOT NULL CHECK (category IN ('PPT snapshot','Product','Key update','Other')),
 caption text NOT NULL DEFAULT '',
 source_url text NOT NULL DEFAULT '',
 image_data text NOT NULL CHECK (length(image_data) <= 1400000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS thesis_images_scenario_idx ON public.thesis_images(scenario_id);
