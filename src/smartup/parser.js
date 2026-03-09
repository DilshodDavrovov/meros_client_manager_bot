const DEFERRAL_GROUP_IDS = (process.env.DEFERRAL_GROUP_IDS || '136')
  .split(',')
  .map(s => String(s.trim()))
  .filter(Boolean);

/**
 * Извлекает данные клиента из ответа Smartup
 * Формат: [marker, formMeta, clientData, []], клиент в индексе 2
 * person_groups: [[group_id, label, value_id, value], ...]
 */
function parseClientFromEditModel(body) {
  if (!body || typeof body !== 'object') return null;

  let data = null;
  if (Array.isArray(body) && body[2] && typeof body[2] === 'object') {
    data = body[2];
  } else if (body.Тело && Array.isArray(body.Тело) && body.Тело[2]) {
    data = body.Тело[2];
  } else if (body.Telo && Array.isArray(body.Telo) && body.Telo[2]) {
    data = body.Telo[2];
  } else if (Array.isArray(body) && body[1] && typeof body[1] === 'object' && body[1].person_id) {
    data = body[1];
  }

  if (!data || typeof data !== 'object') return null;

  const name = data.name || data.short_name || '';
  const inn = data.details?.tin || data.inn || data.tin || '';
  const regionId = data.details?.region_id || '';
  const regions = data.regions || [];
  const region = regionId && Array.isArray(regions)
    ? (regions.find(r => r[0] === regionId)?.[1] || regionId)
    : regionId || '';

  let deferral = '';
  let currentPersonTypeId = '';
  const pg = data.person_groups || [];
  if (Array.isArray(pg)) {
    for (const g of pg) {
      const gid = Array.isArray(g) ? g[0] : (g.group_id ?? g.groupId);
      if (DEFERRAL_GROUP_IDS.includes(String(gid))) {
        deferral = Array.isArray(g) ? (g[3] || g[2] || '') : (g.name || g.value || '');
        currentPersonTypeId = Array.isArray(g) ? (g[2] || '') : (g.person_type_id ?? g.personTypeId ?? '');
        break;
      }
    }
  }

  return {
    name: String(name || '—'),
    deferral: String(deferral || '—'),
    inn: String(inn || '—'),
    region: String(region || '—'),
    raw: data,
    currentPersonTypeId: String(currentPersonTypeId || ''),
  };
}

function buildDeferralValueMap(options) {
  return (options || []).reduce((acc, o) => {
    if (o.id && o.label) acc[o.label.toLowerCase().trim()] = o.id;
    return acc;
  }, {});
}

function resolvePersonTypeId(newDeferralValue, existingTypeId, deferralOptions = []) {
  if (typeof newDeferralValue === 'object' && newDeferralValue !== null && 'personTypeId' in newDeferralValue) {
    return newDeferralValue.personTypeId ?? '';
  }
  if (typeof newDeferralValue !== 'string') return existingTypeId || '';
  const map = buildDeferralValueMap(deferralOptions);
  const key = newDeferralValue.toLowerCase().trim();
  return map[key] || existingTypeId || '';
}

/**
 * Собирает payload для $save из raw-данных GET
 * Save ожидает: person_types: [{person_group_id, person_type_id}, ...]
 * @param {object} rawClient
 * @param {string} personId
 * @param {string|{personTypeId, label}} newDeferralValue
 * @param {Array<{id, label}>} [deferralOptions] - для resolve label->id при restore
 */
function buildSavePayload(rawClient, personId, newDeferralValue, deferralOptions) {
  const d = rawClient.details || {};
  const personTypes = buildPersonTypes(rawClient, newDeferralValue, deferralOptions);
  const bankAccounts = (rawClient.bank_accounts || []).map(ba => {
    if (Array.isArray(ba)) {
      return {
        bank_id: ba[0],
        bank_code: ba[2],
        bank_account_id: ba[3],
        bank_account_code: ba[4],
        bank_account_name: ba[5],
        is_main: ba[6] || 'N',
        currency_id: ba[7],
        state: ba[9] || 'A',
        note: ba[10] || '',
        id: ba[7] || '',
      };
    }
    return ba;
  }).filter(Boolean);
  const contracts = (rawClient.contracts || []).map(c => {
    if (Array.isArray(c)) {
      return {
        contract_id: c[0],
        contract_date: c[1],
        contract_number: c[2],
        contract_name: c[3],
        currency_id: c[4],
        currency_name: c[5],
        amount: c[6] || '',
        expiry_date: c[7] || '',
        note: c[8] || '',
        initial_amount: c[9] || '',
        initial_expiry_date: c[10] || '',
        state: c[11] || 'A',
        code: c[12] || '',
        is_main: c[13] || '',
        contract_type: c[14] || 'D',
        is_mandatory_prepayment: c[15] || 'N',
      };
    }
    return c;
  }).filter(Boolean);
  const files = (rawClient.files || []).map(f => {
    if (Array.isArray(f)) {
      return { title: f[0], note: f[1] || '', file_sha: f[2], file_name: f[3], id: f[4] };
    }
    return f;
  }).filter(Boolean);
  const contacts = (rawClient.contacts || []).map(c => {
    if (Array.isArray(c)) {
      return {
        person_contact_id: c[0] || '',
        contact_name: c[1] || '',
        position_id: c[2] || '',
        position_name: c[3] || '',
        phone_number: c[4] || '',
        birthday: c[5] || '',
        note: c[6] || '',
      };
    }
    if (c && typeof c === 'object' && ('person_contact_id' in c || 'contact_name' in c)) {
      return {
        person_contact_id: c.person_contact_id || '',
        contact_name: c.contact_name || '',
        position_id: c.position_id || '',
        position_name: c.position_name || '',
        phone_number: c.phone_number || '',
        birthday: c.birthday || '',
        note: c.note || '',
      };
    }
    return null;
  }).filter(Boolean);

  return {
    person_id: personId,
    name: rawClient.name || '',
    short_name: rawClient.short_name || rawClient.name || '',
    state: rawClient.state || 'A',
    code: rawClient.code || '',
    primary_person_id: rawClient.primary_person_id || '',
    latlng: '',
    allow_owner: rawClient.allow_owner || 'N',
    email: rawClient.email || '',
    is_supplier: rawClient.is_supplier || 'N',
    is_client: rawClient.is_client || 'Y',
    details: {
      tin: d.tin || '',
      cea: d.cea || '',
      main_phone: d.main_phone || '',
      web: d.web || '',
      telegram: d.telegram || '',
      post_address: d.post_address || '',
      address: d.address || '',
      address_guide: d.address_guide || '',
      parent_person_id: d.parent_person_id || '',
      region_id: d.region_id || '',
      barcode: d.barcode || '',
      note: d.note || '',
      zip_code: d.zip_code || '',
      vat_code: d.vat_code || '',
      is_budgetarian: d.is_budgetarian || 'N',
      director_first_name: d.director_first_name || '',
      director_last_name: d.director_last_name || '',
      director_middle_name: d.director_middle_name || '',
      accountant_first_name: d.accountant_first_name || '',
      accountant_last_name: d.accountant_last_name || '',
      accountant_middle_name: d.accountant_middle_name || '',
      director_tin: d.director_tin || '',
    },
    telegram_users: rawClient.telegram_users || [],
    person_types: personTypes,
    bank_accounts: bankAccounts,
    contacts,
    contracts,
    files,
    addresses: rawClient.addresses || [],
    photo_sha: rawClient.photo_sha || '',
    room_ids: (rawClient.rooms || []).map(r => r[0]).filter(Boolean),
    activity_ids: rawClient.activity_ids || rawClient.activities || [],
  };
}

function buildPersonTypes(rawClient, newDeferralValue, deferralOptions) {
  const pg = rawClient?.person_groups || [];
  const result = [];
  const deferralIds = new Set(DEFERRAL_GROUP_IDS);

  for (const g of pg) {
    const groupId = Array.isArray(g) ? g[0] : g?.person_group_id;
    const typeId = Array.isArray(g) ? g[2] : g?.person_type_id;
    const isDeferral = deferralIds.has(String(groupId));
    const newTypeId = isDeferral ? resolvePersonTypeId(newDeferralValue, typeId, deferralOptions) : typeId;
    result.push({
      person_group_id: String(groupId),
      person_type_id: isDeferral ? newTypeId : (typeId || ''),
    });
  }

  for (const gid of DEFERRAL_GROUP_IDS) {
    if (!result.some(r => r.person_group_id === String(gid))) {
      result.push({ person_group_id: String(gid), person_type_id: resolvePersonTypeId(newDeferralValue, '', deferralOptions) });
    }
  }

  return result;
}

/** @deprecated - используется buildSavePayload */
function buildPersonGroupsWithNewDeferral(rawClient, newDeferralValue) {
  return buildPersonTypes(rawClient, newDeferralValue);
}

module.exports = {
  parseClientFromEditModel,
  buildPersonGroupsWithNewDeferral,
  buildSavePayload,
  DEFERRAL_GROUP_IDS,
};
