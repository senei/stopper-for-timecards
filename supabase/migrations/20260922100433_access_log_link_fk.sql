-- Close a data-integrity gap flagged in the private-link-access implementation
-- review (F1): nothing stopped access_log.link_id from referencing a link
-- that doesn't exist in `links`.
--
-- ON DELETE defaults to NO ACTION (no CASCADE/SET NULL specified): links are
-- never deleted by any code path in this app (no removal mechanism, by
-- design — see FR-007), so an attempted delete of a referenced link failing
-- loudly is the safe default rather than silently orphaning or nulling rows.
--
-- time_entries.link_id is deliberately left unconstrained: that table is a
-- placeholder pending rework by a later roadmap slice (S-02), and adding a
-- constraint now would likely need to be redone once its real schema lands.
alter table access_log
  add constraint access_log_link_id_fkey
  foreign key (link_id) references links (id);
