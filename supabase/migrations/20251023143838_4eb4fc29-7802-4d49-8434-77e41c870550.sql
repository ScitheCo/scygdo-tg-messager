-- Add unique constraint on worker_id for upsert operations
ALTER TABLE public.worker_heartbeats 
ADD CONSTRAINT worker_heartbeats_worker_id_unique UNIQUE (worker_id);