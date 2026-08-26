const AUTH_MESSAGES=Object.freeze({
  invalidCredentials:"Неверный email или пароль.",
  emailNotConfirmed:"Сначала подтвердите email по ссылке из письма.",
  alreadyRegistered:"Аккаунт с таким email уже существует.",
  rateLimit:"Письмо уже было отправлено. Повторите попытку примерно через минуту.",
  weakPassword:"Пароль не соответствует требованиям безопасности.",
  network:"Не удалось связаться с сервисом. Проверьте подключение к интернету и попробуйте снова.",
  unknown:"Не удалось выполнить операцию с аккаунтом. Попробуйте ещё раз."
});

function authErrorMessage(error){
  const message=String(error?.message||"");
  const code=String(error?.code||"");
  const status=Number(error?.status||0);
  if(/invalid login credentials/i.test(message)||code==="invalid_credentials")return AUTH_MESSAGES.invalidCredentials;
  if(/email not confirmed/i.test(message)||code==="email_not_confirmed")return AUTH_MESSAGES.emailNotConfirmed;
  if(/user already registered|already been registered/i.test(message)||code==="user_already_exists")return AUTH_MESSAGES.alreadyRegistered;
  if(status===429||/rate limit|security purposes|after \d+ seconds|too many requests/i.test(message))return AUTH_MESSAGES.rateLimit;
  if(/password/i.test(message)&&/least|short|weak|characters|requirements/i.test(message))return AUTH_MESSAGES.weakPassword;
  if(/failed to fetch|network|load failed|networkerror/i.test(message))return AUTH_MESSAGES.network;
  return AUTH_MESSAGES.unknown;
}

function authReturnUrl(currentHref){
  const current=new URL(currentHref);
  if(current.hostname.endsWith("github.io")){
    const segment=current.pathname.split("/").filter(Boolean)[0];
    return `${current.origin}/${segment?`${segment}/`:""}`;
  }
  return `${current.origin}/`;
}

function inspectAuthReturn(currentHref){
  const url=new URL(currentHref);
  const hash=new URLSearchParams(url.hash.replace(/^#/,""));
  const read=key=>url.searchParams.get(key)||hash.get(key);
  const type=read("type");
  const error=read("error_description")||read("error");
  return {isAuthReturn:!!(type||read("code")||read("access_token")||error),type,error};
}

export {AUTH_MESSAGES,authErrorMessage,authReturnUrl,inspectAuthReturn};
