function domainMatches(hostname, domain) {
  const normalized=String(domain||'').replace(/^\./,'').toLowerCase();
  return Boolean(normalized)&&(hostname===normalized||hostname.endsWith(`.${normalized}`));
}

function pathMatches(pathname, cookiePath) {
  const normalized=String(cookiePath||'/');
  return pathname===normalized||pathname.startsWith(normalized.endsWith('/')?normalized:`${normalized}/`);
}

export function cookieHeaderForUrl(cookies, url, now=Date.now()) {
  const target=new URL(url);
  const currentSeconds=now/1000;
  return cookies
    .filter(cookie=>domainMatches(target.hostname.toLowerCase(),cookie.domain))
    .filter(cookie=>pathMatches(target.pathname,cookie.path))
    .filter(cookie=>!cookie.secure||target.protocol==='https:')
    .filter(cookie=>!Number.isFinite(cookie.expires)||cookie.expires<0||cookie.expires>currentSeconds)
    .sort((a,b)=>String(b.path||'/').length-String(a.path||'/').length)
    .map(cookie=>`${cookie.name}=${cookie.value}`)
    .join('; ');
}
