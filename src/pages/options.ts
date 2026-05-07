const app = document.querySelector<HTMLElement>("#app");

if (app) {
  app.textContent = "";

  const heading = document.createElement("h1");
  heading.textContent = "Options";

  app.append(heading);
}

export {};
