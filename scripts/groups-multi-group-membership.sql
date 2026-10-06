-- Allows one employee_id to belong to more than one group — previously
-- employee_id alone was group_members' primary key (see groups-schema.sql),
-- so adding the same employee to a second group silently moved them
-- instead of granting a second membership.
alter table group_members drop constraint group_members_pkey;
alter table group_members add primary key (employee_id, group_id);
