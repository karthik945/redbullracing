import { CATEGORIES, getCategory, getProduct, imagePath, formatPrice } from "./shop-data.js";
import { addToCart, updateCartBadges } from "./cart.js";

updateCartBadges();

// cart is still a stub — real checkout is a later phase (same note as main.js)
document.getElementById("nav-cart")?.addEventListener("click", (e) => e.preventDefault());
document.getElementById("footer-cart")?.addEventListener("click", (e) => e.preventDefault());

const page = document.body.dataset.page;

if (page === "shop-index") renderCategoryGrid();
if (page === "shop-category") renderCategoryPage();
if (page === "shop-product") renderProductPage();

function renderCategoryGrid() {
  const grid = document.getElementById("cat-grid");
  if (!grid) return;
  grid.innerHTML = CATEGORIES.map(
    (c) => `
    <a class="shop-cat-card" href="/shop/category.html?c=${c.key}">
      <img src="${imagePath(c.key, 1)}" alt="" loading="lazy" />
      <div class="shop-cat-body">
        <h3>${c.name}</h3>
        <p>${c.tagline}</p>
        <span class="shop-cat-count">${c.products.length} items</span>
      </div>
    </a>`
  ).join("");
}

function renderCategoryPage() {
  const key = new URLSearchParams(location.search).get("c");
  const category = getCategory(key);
  if (!category) {
    location.href = "/shop/index.html";
    return;
  }

  document.title = `${category.name} — RB19 Merchandise`;
  document.getElementById("cat-eyebrow").textContent = "Oracle Red Bull Racing";
  document.getElementById("cat-name").textContent = category.name;
  document.getElementById("cat-tagline").textContent = category.tagline;
  document.getElementById("crumb-current").textContent = category.name;

  const grid = document.getElementById("product-grid");
  grid.innerHTML = category.products
    .map(
      (p) => `
    <a class="shop-product-card" href="/shop/product.html?c=${category.key}&id=${p.id}">
      <img src="${imagePath(category.key, p.id)}" alt="" loading="lazy" />
      <div class="shop-product-name">${p.name}</div>
      <div class="shop-product-price">${formatPrice(p.price)}</div>
    </a>`
    )
    .join("");
}

function renderProductPage() {
  const params = new URLSearchParams(location.search);
  const key = params.get("c");
  const id = params.get("id");
  const category = getCategory(key);
  const product = getProduct(key, id);
  if (!category || !product) {
    location.href = "/shop/index.html";
    return;
  }

  document.title = `${product.name} — RB19 Merchandise`;
  document.getElementById("crumb-category").textContent = category.name;
  document.getElementById("crumb-category").href = `/shop/category.html?c=${category.key}`;
  document.getElementById("crumb-current").textContent = product.name;

  document.getElementById("detail-image").src = imagePath(category.key, product.id);
  document.getElementById("detail-cat").textContent = category.name;
  document.getElementById("detail-name").textContent = product.name;
  document.getElementById("detail-price").textContent = formatPrice(product.price);
  document.getElementById("detail-desc").textContent = product.desc;

  const addBtn = document.getElementById("add-to-cart");
  const addedNote = document.getElementById("added-note");
  let noteTimer = null;
  addBtn.addEventListener("click", () => {
    addToCart(category.key, product.id);
    addedNote.classList.add("visible");
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => addedNote.classList.remove("visible"), 1800);
  });

  const relatedGrid = document.getElementById("related-grid");
  relatedGrid.innerHTML = category.products
    .filter((p) => p.id !== product.id)
    .map(
      (p) => `
    <a class="shop-product-card" href="/shop/product.html?c=${category.key}&id=${p.id}">
      <img src="${imagePath(category.key, p.id)}" alt="" loading="lazy" />
      <div class="shop-product-name">${p.name}</div>
      <div class="shop-product-price">${formatPrice(p.price)}</div>
    </a>`
    )
    .join("");
}
