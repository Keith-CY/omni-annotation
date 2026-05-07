const app = document.querySelector<HTMLElement>("#app");

if (app) {
  app.textContent = "";

  const heading = document.createElement("h1");
  heading.textContent = "Omni Annotation";

  app.append(heading);
}

export {};
