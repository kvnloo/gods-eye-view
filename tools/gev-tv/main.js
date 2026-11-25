// The Samsung TV end of GEV's Cast button (src/ui/cast/): keep one room code on
// this TV, then open the TV view in it. The GEV server launches this app over
// the LAN and waits for the TV view to report in that room.
// ES5 only, and it must stay in a file: the widget CSP refuses inline scripts.
// SITE comes from site.js, which install.sh writes (the server's LAN address).
var room = localStorage.getItem("room");
if (!/^[a-z0-9]{6}$/.test(room || "")) {
  var A = "abcdefghijkmnpqrstuvwxyz23456789", b = crypto.getRandomValues(new Uint8Array(6)); room = "";
  for (var i = 0; i < 6; i++) room += A[b[i] & 31];
  localStorage.setItem("room", room);
}
function get(f) { try { return f(); } catch (e) { return ""; } }
var model = get(function () { return webapis.productinfo.getRealModel(); });
var name = model ? "Samsung " + model : "Samsung TV";
location.replace(SITE + "?tv=samsung&room=" + room + "&name=" + encodeURIComponent(name));
