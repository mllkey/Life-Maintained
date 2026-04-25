# Cat 2 RPC null-vs-undefined verification — CLOSED

Date: 2026-04-24
Reference commit (the change being verified): e829076
Verification method: read live function definitions from production via pg_get_functiondef on project fqblqrrgjpwysrsiolcn.

## Functions verified

### complete_vehicle_task
Signature: complete_vehicle_task(p_task_id uuid, p_mileage numeric DEFAULT NULL, p_hours numeric DEFAULT NULL, p_completed_date timestamptz DEFAULT now(), p_notes text DEFAULT NULL, p_cost numeric DEFAULT NULL, p_skip_log boolean DEFAULT false, p_provider_name text DEFAULT NULL, p_did_it_myself boolean DEFAULT NULL)

Every parameter changed from null to undefined in e829076 has DEFAULT NULL on the SQL side. p_completed_date defaults to now() and is always supplied by callers; p_skip_log defaults to false and is always supplied by callers. Neither was changed in e829076.

### complete_property_task
Signature: complete_property_task(p_task_id uuid, p_completed_date timestamptz DEFAULT now(), p_notes text DEFAULT NULL, p_cost numeric DEFAULT NULL, p_provider_name text DEFAULT NULL, p_did_it_myself boolean DEFAULT NULL)

Every parameter changed from null to undefined in e829076 has DEFAULT NULL on the SQL side.

## Conclusion

PostgREST RPC calls treat an omitted optional argument as "use the function default". Because every changed argument defaults to NULL, the wire-level outcomes of:
  - omitting the key entirely (undefined)
  - sending the key with explicit null
are identical from the perspective of the function body. Both result in the parameter binding to NULL inside plpgsql.

No runtime mismatch exists. No device test required. Cat 2 is closed.
