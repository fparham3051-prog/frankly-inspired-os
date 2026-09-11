(function(){
  "use strict";
  var form = document.getElementById("login-form");
  var errorEl = document.getElementById("login-error");
  form.addEventListener("submit", function(e){
    e.preventDefault();
    errorEl.textContent = "";
    var password = document.getElementById("login-password").value;
    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password })
    }).then(function(res){
      if (res.ok) {
        window.location.href = "/";
      } else {
        errorEl.textContent = "Incorrect password.";
      }
    }).catch(function(){
      errorEl.textContent = "Could not reach the server, try again.";
    });
  });
})();
