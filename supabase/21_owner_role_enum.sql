-- Adds a dedicated owner role without assigning it to any account.
-- Run before 22_owner_control_room.sql on the isolated trial database.
alter type public.user_role add value if not exists 'owner';
