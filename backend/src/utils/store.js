const { daysLeft } = require('./helpers');

/** Store ki wo maloomat jo app ko dikhani hai (PIN/hash kabhi nahi) */
function storePublic(s) {
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    city: s.city,
    phone: s.phone,
    address: s.address,
    logo_url: s.logo_path ? `/uploads/logos/${s.logo_path}` : null,
    plan: s.plan,
    expires_at: s.expires_at,
    days_left: daysLeft(s.expires_at),
    has_pin: !!s.pin_hash
  };
}

module.exports = { storePublic };
