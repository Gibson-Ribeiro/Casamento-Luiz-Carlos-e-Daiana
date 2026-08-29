const params = new URLSearchParams(window.location.search);
const token = params.get("token") || params.get("convite");

if (token) {
  const target = new URL("./convite/", window.location.href);
  target.searchParams.set("token", token);
  target.hash = "galeria";
  window.location.replace(target.toString());
}
