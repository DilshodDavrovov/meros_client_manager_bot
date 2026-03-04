const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const logger = require('../utils/logger');
const { parseClientFromEditModel, buildSavePayload } = require('./parser');

const BASE_URL = (process.env.SMARTUP_BASE_URL || 'https://smartup.merospharm.uz/b/anor/mr/person').replace(/\/?$/, '/');
const SITE_URL = process.env.SMARTUP_SITE_URL || 'https://smartup.merospharm.uz';
const LOGIN_URL = process.env.SMARTUP_LOGIN_URL || `${SITE_URL}/login`;
const TIMEOUT = parseInt(process.env.SMARTUP_HTTP_TIMEOUT_MS || '30000', 10);
const MAX_RETRIES = parseInt(process.env.SMARTUP_MAX_RETRIES || '3', 10);
const SMARTUP_LOGIN = process.env.SMARTUP_LOGIN || '';
const SMARTUP_PASSWORD = process.env.SMARTUP_PASSWORD || '';
const AUTH_TYPE = (process.env.SMARTUP_AUTH_TYPE || 'session').toLowerCase(); // 'basic' | 'session'

let sharedClient = null;
let sessionReady = false;

function getAuthHeader() {
  if (!SMARTUP_LOGIN || !SMARTUP_PASSWORD || AUTH_TYPE !== 'basic') return {};
  const credentials = Buffer.from(`${SMARTUP_LOGIN}:${SMARTUP_PASSWORD}`, 'utf-8').toString('base64');
  return { Authorization: `Basic ${credentials}` };
}

async function ensureSession() {
  if (sessionReady && sharedClient) return sharedClient;
  if (AUTH_TYPE !== 'session' || !SMARTUP_LOGIN || !SMARTUP_PASSWORD) {
    return createClient();
  }

  const jar = new CookieJar();
  const client = wrapper(axios.create({
    baseURL: BASE_URL,
    timeout: TIMEOUT,
    jar,
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' },
    validateStatus: () => true,
  }));

  const loginBody = new URLSearchParams({
    login: SMARTUP_LOGIN,
    password: SMARTUP_PASSWORD,
  }).toString();

  const loginRes = await client.request({
    method: 'POST',
    url: LOGIN_URL,
    data: loginBody,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxRedirects: 5,
  });

  if (loginRes.status >= 400) {
    logger.error('Smartup login failed', LOGIN_URL, loginRes.status);
    throw new Error(`Smartup login failed: ${loginRes.status}`);
  }
  sessionReady = true;
  sharedClient = client;
  return client;
}

function createClient() {
  const config = {
    baseURL: BASE_URL,
    timeout: TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
    validateStatus: () => true,
  };
  return axios.create(config);
}

async function requestWithRetry(method, url, data = null) {
  const client = AUTH_TYPE === 'session' ? await ensureSession() : createClient();
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const config = { method, url };
      if (data) config.data = data;

      const res = await client.request(config);

      if (res.status >= 500) {
        lastError = new Error(`Smartup ${res.status}: ${res.statusText}`);
        logger.warn(`Smartup 5xx, attempt ${attempt}/${MAX_RETRIES}`, url, res.status);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }
      }

      return res;
    } catch (err) {
      lastError = err;
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        logger.warn(`Smartup timeout, attempt ${attempt}/${MAX_RETRIES}`, url);
      } else {
        logger.error('Smartup request error', err.message, url);
      }
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      } else {
        throw lastError;
      }
    }
  }
  throw lastError;
}

/**
 * Загрузить клиента по person_id (edit:model)
 * @param {string} personId
 * @returns {Promise<{ name: string, deferral: string, inn: string, region: string, raw: object } | null>}
 */
async function loadClient(personId) {
  const res = await requestWithRetry('POST', 'legal_person+edit:model', { person_id: String(personId) });
  const body = res.data;

  if (res.status !== 200) {
    logger.error('Smartup loadClient non-200', personId, res.status);
    return null;
  }

  const parsed = parseClientFromEditModel(body);
  if (!parsed) {
    logger.warn('Smartup parseClient failed', personId);
  }
  return parsed;
}

/**
 * Получить список person_type для group 136 (Отсрочка)
 * @returns {Promise<Array<{id: string, label: string}>>}
 */
async function getDeferralOptions() {
  const body = {
    p: {
      column: ['person_type_id', 'name'],
      filter: ['state', '=', 'A'],
      sort: ['name'],
      offset: 0,
      limit: 100,
    },
    d: { person_group_id: '136' },
  };
  const res = await requestWithRetry('POST', 'legal_person_type_list:table', body);
  if (res.status !== 200) {
    logger.error('Smartup getDeferralOptions non-200', res.status);
    return [];
  }
  const data = res.data?.data || [];
  return data
    .filter(row => Array.isArray(row) && row[0] && row[1])
    .map(row => ({ id: String(row[0]), label: String(row[1]).trim() }));
}

/**
 * Найти клиентов по ИНН (tin)
 * @param {string} tin
 * @returns {Promise<Array<{ tin: string, person_id: string, name: string, state: string, head_state: string }>>}
 */
async function searchClientsByTin(tin) {
  const cleanTin = String(tin || '').replace(/\D/g, '');
  if (!cleanTin) return [];

  const body = {
    p: {
      column: ['tin', 'person_id', 'name', 'state', 'head_state'],
      filter: ['tin', 'esearch', `%${cleanTin}%`],
      sort: [],
      offset: 0,
      limit: 50,
    },
    d: { is_filial: 'N' },
  };

  const res = await requestWithRetry('POST', 'legal_person_list:table', body);
  if (res.status !== 200) {
    logger.error('Smartup searchClientsByTin non-200', res.status);
    return [];
  }

  const data = res.data?.data || [];
  return data
    .filter(row => Array.isArray(row) && row[0] && row[1] && row[2])
    .map(row => ({
      tin: String(row[0]),
      person_id: String(row[1]),
      name: String(row[2]),
      state: String(row[3] || ''),
      head_state: String(row[4] || ''),
    }));
}

/**
 * Сохранить клиента (edit$save)
 * @param {object} payload - тело для $save (полный объект клиента)
 */
async function saveClient(payload) {
  const res = await requestWithRetry('POST', 'legal_person+edit$save', payload);
  if (res.status !== 200) {
    logger.error('Smartup saveClient non-200', res.status);
    throw new Error(`Smartup save failed: ${res.status}`);
  }
  return res.data;
}

/**
 * Обновить срок отсрочки и сохранить
 * @param {object} rawClient
 * @param {string|{personTypeId, label}} newDeferralValue
 * @param {string} personId
 */
async function updateDeferralAndSave(rawClient, newDeferralValue, personId) {
  const isObject = typeof newDeferralValue === 'object' && newDeferralValue?.personTypeId;
  const deferralOptions = isObject ? null : await getDeferralOptions();
  const payload = buildSavePayload(rawClient, personId, newDeferralValue, deferralOptions);
  await saveClient(payload);
}

module.exports = {
  loadClient,
  saveClient,
  updateDeferralAndSave,
  getDeferralOptions,
  searchClientsByTin,
};
