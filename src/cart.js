// Cart is still a stub (no real checkout) — this just persists a count
// across pages via localStorage so "ADD TO CART" feels like it does
// something, shared between the shop pages and the main site's nav badge.
const CART_KEY = "rb19-cart";

function readCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
  } catch (e) {
    return [];
  }
}

export function addToCart(key, id) {
  const cart = readCart();
  const existing = cart.find((item) => item.key === key && item.id === id);
  if (existing) existing.qty++;
  else cart.push({ key, id, qty: 1 });
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadges();
}

export function cartCount() {
  return readCart().reduce((total, item) => total + item.qty, 0);
}

export function updateCartBadges() {
  document.querySelectorAll("#cart-count").forEach((el) => {
    el.textContent = cartCount();
  });
}
