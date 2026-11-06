-- Every role holds every permission (owner's decision of 6 November 2026):
-- the board does not always meet in full, and a task only one or two roles
-- could do would wait for them. Roles stay, so the history log still says who
-- acted and in which role. A new database is seeded this way
-- (DEFAULT_MATRIX); this brings one made before it into line. The Permisos tab
-- can narrow a role again afterwards. A month close still takes two people:
-- the months table refuses an approval by the person who prepared it.
UPDATE `role_permissions`
SET `granted` = 1, `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), `updated_by` = NULL
WHERE `granted` = 0;
