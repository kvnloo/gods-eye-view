- Publish explicitly selected wildfire incidents through the shared entity
  context with NIFC/WFIGS provenance. Switching incidents evicts the old record;
  refresh preserves selection ownership and teardown clears only perimeter
  records (kvnloo, #806; quanticsoul4772 diagnosed and reproduced stale selection
  records and proposed the layer-scoped eviction fix).
