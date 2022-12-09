import * as ethers from 'ethers';

interface MyEnv {
  Cloudflare_Authorization: string;

  DOMAIN: string;

  ZONE_ID: string;
  ZONE_NAME: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const fetchFun: ExportedHandlerFetchHandler<MyEnv> = async (req: Request, env, context) => {
  // const url = new URL(req.url);
  if (req.method === 'OPTIONS') {
    const allow = req.headers.get('Access-Control-Request-Headers');
    if (!allow) return new Response(req.method, { status: 404 });
    const respHeaders = { ...corsHeaders, 'Access-Control-Allow-Headers': allow };
    return new Response(null, { headers: respHeaders });
  }
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    Vary: 'Origin',
  };
  if (req.method !== 'POST') return new Response(req.method, { status: 404, headers });

  const body: { action: string; address: string; data: any } = await req.clone().json();
  switch (body.action) {
    case 'get-my-data': {
      const authMessage = String(body.data.authMessage);
      const msgOrign = [`domain: ${env.DOMAIN}`, `action: login`].join('\r\n\n');
      const address = ethers.utils.verifyMessage(msgOrign, authMessage);
      if (address !== body.address) return new Response(`address error`, { status: 400 });
      const api = new CloudflareApi(env);
      let response = await api.getDNSRecords(address);
      response = new Response(response.body, response);
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      return response;
    }
    case 'set-my-data': {
      const time = String(body.data.time);
      const key = String(body.data.key);
      const value = String(body.data.value);
      const authMessage = String(body.data.authMessage);
      const timeDiff = Date.now() - new Date(time).getTime();
      const timeRange = [30 * 60000, 5 * 60000];
      if (isNaN(timeDiff) || timeDiff > timeRange[0] || timeDiff < -timeRange[1]) {
        return new Response(`time error (${timeDiff})`, { status: 400, headers });
      }
      const msgOrign = [`domain: ${env.DOMAIN}`, `time: ${time}`, `key: ${key}`, `value: ${value}`].join('\r\n\n');
      const address = ethers.utils.verifyMessage(msgOrign, authMessage);
      if (address !== body.address) return new Response(`address error`, { status: 400 });
      const api = new CloudflareApi(env);
      let response = await api.CreateDNSRecord({
        name: [address, key].join('.'),
        content: value,
      });
      response = new Response(response.body, response);
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      return response;
    }
    case 'delete-my-data': {
      const time = String(body.data.time);
      const key = String(body.data.key);
      const value = String(body.data.value);
      const authMessage = String(body.data.authMessage);
      const timeDiff = Date.now() - new Date(time).getTime();
      const timeRange = [30 * 60000, 5 * 60000];
      if (isNaN(timeDiff) || timeDiff > timeRange[0] || timeDiff < -timeRange[1]) {
        return new Response(`time error (${timeDiff})`, { status: 400, headers });
      }
      const msgOrign = [`domain: ${env.DOMAIN}`, `time: ${time}`, `key: ${key}`, `value: ${value}`].join('\r\n\n');
      const address = ethers.utils.verifyMessage(msgOrign, authMessage);
      if (address !== body.address) return new Response(`address error`, { status: 400 });
      const api = new CloudflareApi(env);
      let response = await api.DeleteDNSRecord(value);
      response = new Response(response.body, response);
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      return response;
    }
  }
  return new Response(`404`, { status: 404, headers });
};

export default {
  fetch: fetchFun,
};

class CloudflareApi {
  baseURL = 'https://api.cloudflare.com/client/v4';
  Authorization: string;
  env: MyEnv;
  constructor(env: MyEnv) {
    this.Authorization = `Bearer ${env.Cloudflare_Authorization}`;
    this.env = env;
  }
  private async fetch(method: string, url: string, body?: any, headers?: Record<string, string>) {
    url = `${this.baseURL}${url}`;
    headers = headers || {};
    headers.Authorization = this.Authorization;
    headers['content-type'] = headers['content-type'] || 'application/json';
    return fetch(url, { method, headers, body: JSON.stringify(body) });
  }

  async getDNSRecords(address: string) {
    const searchKey = `contains:_dnslink.${address}`;
    const searchURL = new URL(`${this.env.DOMAIN}/zones/${this.env.ZONE_ID}/dns_records`);
    searchURL.searchParams.set('per_page', '50');
    searchURL.searchParams.set('name', searchKey);
    searchURL.searchParams.set('type', searchKey);
    searchURL.searchParams.set('content', searchKey);
    searchURL.searchParams.set('match', 'any');
    return this.fetch('get', searchURL.toString().replace(this.env.DOMAIN, ''));
  }

  /**
   * https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-create-dns-record
   */
  async CreateDNSRecord(body: {
    content: string;
    name: string; // DNS record name (or @ for the zone apex).
    type?: string;
    proxied?: boolean;
    proxiable?: boolean;
    data?: any;
    ttl?: number;
    zone_id?: string;
    zone_name?: string;
  }) {
    const searchKey = `contains:_dnslink.${body.name}`;
    body.name = `_dnslink.${body.name}.${this.env.ZONE_NAME}`;
    body.zone_id = this.env.ZONE_ID;
    body.zone_name = this.env.ZONE_NAME;
    body.ttl = 1;
    body.data = {};
    body.proxiable = false;
    body.proxied = false;
    body.type = 'TXT';
    body.content = `dnslink=${body.content}`;
    const searchURL = new URL(`${this.env.DOMAIN}/zones/${this.env.ZONE_ID}/dns_records`);
    searchURL.searchParams.set('per_page', '50');
    searchURL.searchParams.set('name', searchKey);
    searchURL.searchParams.set('type', searchKey);
    searchURL.searchParams.set('content', searchKey);
    searchURL.searchParams.set('match', 'any');
    console.log(searchURL.toString());
    const search = await this.fetch('get', searchURL.toString().replace(this.env.DOMAIN, ''));
    const json = (await search.clone().json()) as {
      result: [
        {
          id: string; // 'f230f1ce284f1de1d1a70926ea80d656';
          zone_id: string; // 'ca8e3cb63a6c6a37d56430939854bc3b';
          zone_name: string; // 'ipns.fun';
          name: string; // '_dnslink.xxxx.xxx.ipns.fun';
          type: string; // 'TXT';
          content: string; // 'dnslink=/ipfs/QmNnvnFE7T2KmZo6pZW1Z2AmQfYT7sMmJA5NmcKRWyTAdV';
          proxiable: boolean;
          proxied: boolean;
          ttl: number;
          locked: boolean;
          meta: {
            auto_added: boolean;
            managed_by_apps: boolean;
            managed_by_argo_tunnel: boolean;
            source: string; // 'primary'
          };
          created_on: string; // '2022-12-05T08:48:15.316953Z';
          modified_on: string; // '2022-12-05T08:48:15.316953Z';
        },
      ];
      success: boolean;
      errors: [];
      messages: [];
      result_info: { page: 1; per_page: 50; count: 1; total_count: 1; total_pages: 1 };
    };
    console.log(json);

    // update
    if (json.success && json.result && json.result[0]) {
      const bak = json.result[0];
      return this.fetch('PATCH', `/zones/${this.env.ZONE_ID}/dns_records/${bak.id}`, body);
    }
    return this.fetch('POST', `/zones/${this.env.ZONE_ID}/dns_records`, body);
  }

  async DeleteDNSRecord(id: string) {
    return this.fetch('DELETE', `/zones/${this.env.ZONE_ID}/dns_records/${id}`);
  }
}
