ALTER TABLE "exercises" ADD COLUMN "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;
