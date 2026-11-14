(function(){
  "use strict";
  var form = document.getElementById("login-form");
  var errorEl = document.getElementById("login-error");
  var codeRow = document.getElementById("code-row");
  form.addEventListener("submit", function(e){
    e.preventDefault();
    errorEl.textContent = "";
    var body = {
      email: document.getElementById("login-email").value.trim(),
      password: document.getElementById("login-password").value,
      code: document.getElementById("login-code").value.trim()
    };
    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function(res){
      if (res.ok) { window.location.href = "/"; return; }
      return res.json().catch(function(){ return {}; }).then(function(d){
        if (d.needCode) { codeRow.hidden = false; document.getElementById("login-code").focus(); }
        errorEl.textContent = d.error || "Sign-in didn't work. Check and try again.";
      });
    }).catch(function(){
      errorEl.textContent = "Could not reach the server, try again.";
    });
  });
})();
