// Shared catalog for the /shop pages. Each category maps 1:1 to one of the
// main site's story beats and its existing /merch/<key>-<n>.jpg assets.
export const CATEGORIES = [
  {
    key: "frontwing",
    name: "Team Jackets",
    tagline: "Outerwear cut for the pit wall, styled like the car that inspired it.",
    products: [
      { id: 1, name: "Pit Wall Team Jacket", price: 189, desc: "Waterproof shell built for the garage, cut with the team's 2023 livery striping." },
      { id: 2, name: "Paddock Bomber", price: 159, desc: "Lightweight bomber in team navy, embroidered crest on the chest." },
      { id: 3, name: "Race Windbreaker", price: 129, desc: "Packable shell for changeable weather trackside, RB19 sponsor block on the sleeve." },
      { id: 4, name: "Garage Softshell", price: 175, desc: "Insulated softshell worn by the mechanics — built to move." },
    ],
  },
  {
    key: "cockpit",
    name: "Race-Day Tees",
    tagline: "What the driver actually wears — team crew, race number, and stripe, straight off the grid.",
    products: [
      { id: 1, name: "Driver Tee", price: 45, desc: "Cotton crew tee in team colors, No. 1 print on the back." },
      { id: 2, name: "Grid Number Tee", price: 42, desc: "Race-number graphic tee, the exact stripe off the RB19's flank." },
      { id: 3, name: "Crew Tee", price: 38, desc: "The tee the mechanics wear on the wall, now off the grid." },
      { id: 4, name: "Podium Tee", price: 48, desc: "Champagne-soaked graphic, straight off the top step." },
    ],
  },
  {
    key: "rearwing",
    name: "Race-Day Prints",
    tagline: "Frame the moment DRS opens and the gap disappears.",
    products: [
      { id: 1, name: "DRS Open Print", price: 65, desc: "The rear wing flap at the exact instant it opens." },
      { id: 2, name: "Slipstream Print", price: 65, desc: "The overtake, frozen mid-corner." },
      { id: 3, name: "Apex Print", price: 65, desc: "RB19 at full lean, tyres loaded." },
      { id: 4, name: "Checkered Flag Print", price: 75, desc: "The moment the season was won." },
    ],
  },
  {
    key: "diffuser",
    name: "Scale Collectibles",
    tagline: "Every detail Newey hid underneath, replicated down to the millimetre.",
    products: [
      { id: 1, name: "RB19 1:18 Scale Model", price: 249, desc: "Die-cast replica, full livery, display case included." },
      { id: 2, name: "RB19 1:43 Scale Model", price: 89, desc: "Pocket-sized replica for the desk or the shelf." },
      { id: 3, name: "Floor & Diffuser Cutaway", price: 135, desc: "The ground-effect geometry, exposed." },
      { id: 4, name: "Engine Cutaway Model", price: 155, desc: "The Honda RBPT hybrid V6, sectioned for display." },
    ],
  },
  {
    key: "anatomy",
    name: "Trackside Accessories",
    tagline: "Every small piece has a job. So does everything here.",
    products: [
      { id: 1, name: "Pit Crew Cap", price: 35, desc: "Six-panel cap, embroidered team crest." },
      { id: 2, name: "Radio Earpiece Case", price: 28, desc: "Hard case for the same kit the pit wall uses." },
      { id: 3, name: "Paddock Lanyard", price: 18, desc: "Access-all-areas styling, team colors." },
      { id: 4, name: "Garage Toolkit Pouch", price: 32, desc: "Compact roll for the essentials, RB19 stitched on the flap." },
    ],
  },
  {
    key: "stats",
    name: "Limited Edition",
    tagline: "Numbered pieces for a record-breaking season — only 500 of each ever made.",
    products: [
      { id: 1, name: "21 Wins Numbered Print", price: 95, desc: "One of only 500. Individually numbered." },
      { id: 2, name: "860 Points Commemorative Plaque", price: 145, desc: "Cast in metal, the record season in numbers." },
      { id: 3, name: "Championship Season Box Print", price: 110, desc: "Every win of 2023, laid out race by race." },
      { id: 4, name: "Newey Signature Edition Cap", price: 85, desc: "Limited run, technical director's signature stitched inside." },
    ],
  },
  {
    key: "closer",
    name: "The Champion's Bundle",
    tagline: "Everything the season earned, boxed for the ones who watched it happen.",
    products: [
      { id: 1, name: "Champion's Bundle — Jacket + Tee", price: 299, desc: "The jacket and the tee, boxed together." },
      { id: 2, name: "Champion's Bundle — Print Set", price: 180, desc: "All four race-day prints, framed as a set." },
      { id: 3, name: "Champion's Bundle — Scale Model + Cap", price: 260, desc: "The 1:43 model and the pit crew cap, boxed." },
      { id: 4, name: "Champion's Bundle — Full Collection", price: 649, desc: "One of everything. The whole season, boxed." },
    ],
  },
];

export function getCategory(key) {
  return CATEGORIES.find((c) => c.key === key);
}

export function getProduct(key, id) {
  const category = getCategory(key);
  return category && category.products.find((p) => p.id === Number(id));
}

export function imagePath(key, id) {
  return `/merch/${key}-${id}.jpg`;
}

export function formatPrice(price) {
  return `$${price.toLocaleString("en-US")}`;
}
