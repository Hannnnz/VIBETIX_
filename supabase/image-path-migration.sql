-- Migration: add image_path column to concerts for Supabase Storage uploads
alter table public.concerts
  add column if not exists image_path text;