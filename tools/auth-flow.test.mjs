import assert from "node:assert/strict";
import {authErrorMessage,authReturnUrl,inspectAuthReturn} from "../js/auth-flow.js";

assert.equal(authReturnUrl("https://tadana-zanzarah.github.io/author-workspace/?x=1"),"https://tadana-zanzarah.github.io/author-workspace/");
assert.equal(authReturnUrl("http://localhost:8000/"),"http://localhost:8000/");
assert.equal(authReturnUrl("http://127.0.0.1:8000/author-workspace/"),"http://127.0.0.1:8000/");
assert.equal(authErrorMessage({status:429,message:"For security purposes, you can only request this after 52 seconds."}),"Письмо уже было отправлено. Повторите попытку примерно через минуту.");
assert.equal(authErrorMessage({message:"Invalid login credentials"}),"Неверный email или пароль.");
assert.deepEqual(inspectAuthReturn("https://example.test/?type=signup"),{isAuthReturn:true,type:"signup",error:null});
console.log("auth flow unit tests passed");
