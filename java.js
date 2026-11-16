(() => {
  "use strict";

  const STORAGE_KEY = "cronicas-mestre-v1";
  const BOOK_DATABASE = "cronicas-biblioteca-v1";
  const BOOK_ID = "active-book";
  const state = loadState();
  const timers = new Map();
  let modalKind = null;
  let editingId = null;
  let toastTimeout = null;
  let bookDatabase = null;
  let activeBook = null;
  let pdfDocument = null;
  let pdfRenderTask = null;
  let pdfLoadToken = 0;
  let pdfRenderToken = 0;
  let pdfPageNumber = 1;
  let pdfZoom = 1;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        characters: Array.isArray(saved.characters) ? saved.characters : [],
        items: Array.isArray(saved.items) ? saved.items : [],
        timers: Array.isArray(saved.timers) ? saved.timers : []
      };
    } catch (error) {
      console.error("Não foi possível ler os dados salvos:", error);
      return { characters: [], items: [], timers: [] };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $(".save-status").innerHTML = "<i></i> Tudo salvo";
    } catch (error) {
      console.error("Não foi possível salvar os dados:", error);
      $(".save-status").innerHTML = "<i class=\"error-dot\"></i> Falha ao salvar";
      showToast("Não foi possível salvar. Remova imagens grandes ou exporte seus dados.");
    }
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("visible"), 3200);
  }

  function navigate(viewName) {
    $$(".view").forEach(view => view.classList.toggle("active-view", view.id === `view-${viewName}`));
    $$(".nav-link[data-view]").forEach(link => link.classList.toggle("active",
      link.dataset.view === viewName || (link.dataset.view === "library" && !$("#pdf-reader").hidden)));
    const labels = { overview: "Visão geral", characters: "Personagens", items: "Itens", timers: "Cronômetros" };
    $("#breadcrumb-current").textContent = labels[viewName] || labels.overview;
    window.scrollTo({ top: 0, behavior: "smooth" });
    render();
  }

  function openBookDatabase() {
    if (bookDatabase) return Promise.resolve(bookDatabase);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(BOOK_DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("books", { keyPath: "id" });
      request.onsuccess = () => {
        bookDatabase = request.result;
        resolve(bookDatabase);
      };
      request.onerror = () => reject(request.error || new Error("Não foi possível abrir a biblioteca."));
    });
  }

  function bookTransaction(mode, operation) {
    return openBookDatabase().then(database => new Promise((resolve, reject) => {
      const transaction = database.transaction("books", mode);
      let result;
      const request = operation(transaction.objectStore("books"));
      if (request) {
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => reject(request.error || new Error("Não foi possível acessar o livro."));
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("Não foi possível salvar a biblioteca."));
      transaction.onabort = () => reject(transaction.error || new Error("A operação na biblioteca foi cancelada."));
    }));
  }

  function displayBook(book) {
    releaseBookViewer();
    activeBook = book || null;
    $("#pdf-reader-empty").hidden = Boolean(book);
    $("#pdf-document").hidden = !book;
    $("#pdf-reader-error").hidden = true;
    $("#pdf-toolbar").hidden = true;
    $("#pdf-remove-button").hidden = !book;
    $("#pdf-book-name").textContent = book ? book.name : "Livro de RPG";
    pdfPageNumber = 1;
    pdfZoom = 1;
    $("#pdf-canvas").width = 0;
    $("#pdf-canvas").height = 0;
    if (book && !$("#pdf-reader").hidden) showBookViewer();
  }

  function showPdfError(message) {
    $("#pdf-document").hidden = true;
    $("#pdf-reader-error-message").textContent = message;
    $("#pdf-reader-error").hidden = false;
  }

  async function showBookViewer() {
    if (!activeBook || pdfDocument) return;
    if (!window.pdfjsLib) {
      showPdfError("O leitor de PDF não carregou. Verifique sua conexão com a internet e tente novamente.");
      return;
    }

    const token = ++pdfLoadToken;
    $("#pdf-reader-error").hidden = true;
    $("#pdf-document").hidden = false;
    $("#pdf-loading").textContent = "Carregando PDF...";
    $("#pdf-loading").hidden = false;
    try {
      const data = new Uint8Array(await activeBook.file.arrayBuffer());
      const loadingTask = window.pdfjsLib.getDocument({ data, disableWorker: true });
      const document = await loadingTask.promise;
      if (token !== pdfLoadToken || !activeBook) {
        await document.destroy();
        return;
      }
      pdfDocument = document;
      $("#pdf-loading").hidden = true;
      $("#pdf-toolbar").hidden = false;
      $("#pdf-page-count").textContent = pdfDocument.numPages;
      $("#pdf-page-input").max = pdfDocument.numPages;
      await renderPdfPage();
    } catch (error) {
      if (token !== pdfLoadToken) return;
      console.error("Não foi possível renderizar o livro PDF:", error);
      showPdfError("O arquivo não pôde ser lido. Confira se ele é um PDF válido e tente selecioná-lo novamente.");
    }
  }

  async function renderPdfPage() {
    if (!pdfDocument) return;
    const renderToken = ++pdfRenderToken;
    const document = pdfDocument;
    const pageNumber = pdfPageNumber;
    if (pdfRenderTask) pdfRenderTask.cancel();
    pdfRenderTask = null;
    try {
      const page = await document.getPage(pageNumber);
      if (renderToken !== pdfRenderToken || document !== pdfDocument) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const fitScale = Math.min(1, Math.max(1, $("#pdf-page-container").clientWidth - 28) / baseViewport.width);
      const viewport = page.getViewport({ scale: fitScale * pdfZoom });
      const canvas = $("#pdf-canvas");
      const outputScale = window.devicePixelRatio || 1;
      const context = canvas.getContext("2d");
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.setAttribute("aria-label", `Página ${pageNumber} do livro ${activeBook.name}`);
      $("#pdf-page-input").value = pageNumber;
      $("#pdf-zoom-level").textContent = `${Math.round(pdfZoom * 100)}%`;
      $("#pdf-previous-page").disabled = pageNumber <= 1;
      $("#pdf-next-page").disabled = pageNumber >= document.numPages;
      $("#pdf-page-container").scrollTop = 0;
      const renderTask = page.render({
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
      });
      pdfRenderTask = renderTask;
      await renderTask.promise;
    } catch (error) {
      if (error.name !== "RenderingCancelledException" && renderToken === pdfRenderToken) {
        console.error("Não foi possível renderizar a página do PDF:", error);
        showPdfError("Ocorreu um erro ao desenhar esta página do PDF.");
      }
    } finally {
      if (renderToken === pdfRenderToken) pdfRenderTask = null;
    }
  }

  function releaseBookViewer() {
    pdfLoadToken += 1;
    pdfRenderToken += 1;
    if (pdfRenderTask) pdfRenderTask.cancel();
    pdfRenderTask = null;
    if (pdfDocument) {
      pdfDocument.destroy().catch(error => console.error("Não foi possível fechar o livro PDF:", error));
    }
    pdfDocument = null;
  }

  function goToPdfPage(value) {
    const pageNumber = Number(value);
    if (!pdfDocument || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdfDocument.numPages) {
      $("#pdf-page-input").value = pdfPageNumber;
      if (pdfDocument) showToast(`Informe uma página entre 1 e ${pdfDocument.numPages}.`);
      return;
    }
    pdfPageNumber = pageNumber;
    renderPdfPage();
  }

  async function loadBook() {
    try {
      const book = await bookTransaction("readonly", store => store.get(BOOK_ID));
      if (book) displayBook(book);
    } catch (error) {
      console.error("Não foi possível carregar o livro PDF:", error);
      showToast("Não foi possível abrir a biblioteca neste dispositivo.");
    }
  }

  async function addBook(file) {
    if (!file) return;
    try {
      if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) {
        throw new Error("Escolha um arquivo PDF válido.");
      }
      const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
      if (!header.includes("%PDF-")) throw new Error("O arquivo selecionado não parece ser um PDF válido.");
      const book = { id: BOOK_ID, name: file.name, file: file.slice(0, file.size, "application/pdf") };
      await bookTransaction("readwrite", store => store.put(book));
      displayBook(book);
      showToast("Livro PDF salvo neste dispositivo.");
    } catch (error) {
      console.error("Não foi possível adicionar o livro PDF:", error);
      showToast(error.message || "Não foi possível salvar o livro PDF neste dispositivo.");
    } finally {
      $("#pdf-file-input").value = "";
    }
  }

  async function removeBook() {
    if (!activeBook || !window.confirm("Remover este livro salvo neste dispositivo?")) return;
    try {
      await bookTransaction("readwrite", store => store.delete(BOOK_ID));
      displayBook(null);
      showToast("Livro removido da biblioteca.");
    } catch (error) {
      console.error("Não foi possível remover o livro PDF:", error);
      showToast("Não foi possível remover o livro PDF.");
    }
  }

  function toggleBookReader(forceOpen) {
    const reader = $("#pdf-reader");
    const isOpen = forceOpen ?? reader.hidden;
    reader.hidden = !isOpen;
    document.body.classList.toggle("pdf-reader-open", isOpen);
    $('[data-view="library"]').setAttribute("aria-expanded", String(isOpen));
    $('[data-view="library"]').classList.toggle("active", isOpen);
    if (isOpen) showBookViewer();
    else releaseBookViewer();
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const hours = Math.floor(mins / 60);
    return hours ? `${String(hours).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function imageMarkup(image, alt, classes = "") {
    return image
      ? `<img class="${classes}" src="${escapeHtml(image)}" alt="${escapeHtml(alt)}">`
      : `<span class="${classes} image-placeholder" aria-hidden="true">✦</span>`;
  }

  function renderCharacter(character) {
    const health = Math.max(0, Math.min(100, Number(character.healthMax) ? Number(character.health) / Number(character.healthMax) * 100 : 0));
    const mana = Math.max(0, Math.min(100, Number(character.manaMax) ? Number(character.mana) / Number(character.manaMax) * 100 : 0));
    return `<article class="character-row">
      ${imageMarkup(character.image, character.name, "character-avatar")}
      <div class="character-main"><strong>${escapeHtml(character.name)}</strong><small>${escapeHtml(character.role || "Aventureiro")}</small></div>
      <div class="character-stat"><span>DEF</span><strong>${escapeHtml(character.defense || "—")}</strong></div>
      <div class="resource-stat"><div><span>VIDA</span><small>${escapeHtml(character.health)}/${escapeHtml(character.healthMax)}</small></div><i><b class="health-fill" style="width:${health}%"></b></i></div>
      <div class="resource-stat"><div><span>MANA</span><small>${escapeHtml(character.mana)}/${escapeHtml(character.manaMax)}</small></div><i><b class="mana-fill" style="width:${mana}%"></b></i></div>
      <button class="row-menu" data-edit="character" data-id="${escapeHtml(character.id)}" aria-label="Editar ${escapeHtml(character.name)}" title="Editar personagem">···</button>
    </article>`;
  }

  function renderItem(item) {
    return `<article class="item-tile" data-edit="item" data-id="${escapeHtml(item.id)}" tabindex="0" role="button" aria-label="Editar item ${escapeHtml(item.name)}">
      <div class="item-art">${imageMarkup(item.image, item.name, "item-image")}<span class="rarity-tag">${escapeHtml(item.category || "Item")}</span></div>
      <div class="item-tile-info"><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.description || "Sem descrição.")}</p></div>
    </article>`;
  }

  function timerMarkup(timer, card = false) {
    const current = timers.has(timer.id) ? timers.get(timer.id).remaining : timer.remaining;
    const isRunning = timers.has(timer.id);
    return `<article class="${card ? "timer-card" : "timer-row"} ${current === 0 ? "timer-finished" : ""}">
      <div class="timer-symbol">◷</div><div class="timer-info"><strong>${escapeHtml(timer.name)}</strong><small>${isRunning ? "Em andamento" : current === 0 ? "Tempo esgotado" : "Pausado"}</small></div>
      <strong class="timer-clock" data-timer-clock="${escapeHtml(timer.id)}">${formatTime(current)}</strong>
      <div class="timer-controls"><button class="timer-control" data-timer-toggle="${escapeHtml(timer.id)}" aria-label="${isRunning ? "Pausar" : "Iniciar"} cronômetro">${isRunning ? "Ⅱ" : "▶"}</button><button class="timer-control subtle" data-timer-reset="${escapeHtml(timer.id)}" aria-label="Reiniciar cronômetro">↻</button><button class="timer-control subtle" data-timer-delete="${escapeHtml(timer.id)}" aria-label="Excluir cronômetro">×</button></div>
    </article>`;
  }

  function renderPdfTimers() {
    const monitor = $("#pdf-timer-monitor");
    const liveTimers = $("#pdf-live-timers");
    monitor.hidden = state.timers.length === 0;
    liveTimers.innerHTML = state.timers.map(timer => {
      const current = timers.has(timer.id) ? timers.get(timer.id).remaining : timer.remaining;
      const isRunning = timers.has(timer.id);
      const status = isRunning ? "Em andamento" : current === 0 ? "Tempo esgotado" : "Pausado";
      return `<article class="pdf-live-timer ${isRunning ? "is-running" : ""} ${current === 0 ? "is-finished" : ""}">
        <span class="pdf-live-timer-status">${status}</span>
        <strong class="pdf-live-timer-name">${escapeHtml(timer.name)}</strong>
        <span class="pdf-live-timer-clock">${formatTime(current)}</span>
      </article>`;
    }).join("");
  }

  function render() {
    $("#stat-characters").textContent = state.characters.length;
    $("#stat-items").textContent = state.items.length;
    $("#stat-timers").textContent = state.timers.length;
    $("#nav-character-count").textContent = state.characters.length;
    $("#nav-item-count").textContent = state.items.length;

    const characterRows = state.characters.slice(0, 4).map(renderCharacter).join("");
    $("#overview-character-list").innerHTML = characterRows;
    $("#overview-character-empty").hidden = state.characters.length > 0;
    $("#overview-character-list").hidden = state.characters.length === 0;
    $("#character-card-grid").innerHTML = state.characters.map(character => `
      <article class="character-card">
        <div class="character-card-cover">${imageMarkup(character.image, character.name, "character-cover-image")}<button class="card-edit" data-edit="character" data-id="${escapeHtml(character.id)}" aria-label="Editar personagem">···</button></div>
        <div class="character-card-body"><div class="character-card-title"><div><h3>${escapeHtml(character.name)}</h3><p>${escapeHtml(character.role || "Aventureiro")}</p></div><span class="defense-badge">DEF ${escapeHtml(character.defense || "—")}</span></div>
          <div class="card-resource"><div><span>Vida</span><b>${escapeHtml(character.health)} <small>/ ${escapeHtml(character.healthMax)}</small></b></div><i><b class="health-fill" style="width:${Math.max(0, Math.min(100, Number(character.healthMax) ? Number(character.health) / Number(character.healthMax) * 100 : 0))}%"></b></i></div>
          <div class="card-resource"><div><span>Mana</span><b>${escapeHtml(character.mana)} <small>/ ${escapeHtml(character.manaMax)}</small></b></div><i><b class="mana-fill" style="width:${Math.max(0, Math.min(100, Number(character.manaMax) ? Number(character.mana) / Number(character.manaMax) * 100 : 0))}%"></b></i></div>
          <div class="character-equipment"><span>EQUIPAMENTO</span><p>${escapeHtml(character.equipment || "Nenhum equipamento registrado")}</p></div>
        </div>
      </article>`).join("");
    $("#characters-empty").hidden = state.characters.length > 0;

    const latestItems = state.items.slice(-4).reverse();
    $("#overview-item-grid").innerHTML = latestItems.map(renderItem).join("");
    $("#overview-item-empty").hidden = state.items.length > 0;
    $("#overview-item-grid").hidden = state.items.length === 0;
    $("#item-card-grid").innerHTML = state.items.map(renderItem).join("");
    $("#items-empty").hidden = state.items.length > 0;

    const timerRows = state.timers.slice(0, 4).map(timer => timerMarkup(timer)).join("");
    $("#overview-timer-list").innerHTML = timerRows;
    $("#overview-timer-empty").hidden = state.timers.length > 0;
    $("#overview-timer-list").hidden = state.timers.length === 0;
    $("#timer-card-grid").innerHTML = state.timers.map(timer => timerMarkup(timer, true)).join("");
    $("#timers-empty").hidden = state.timers.length > 0;
    renderPdfTimers();
  }

  function openModal(kind, id = null) {
    modalKind = kind;
    editingId = id;
    const existing = id ? state[`${kind}s`].find(entry => entry.id === id) : null;
    const edit = Boolean(existing);
    const titles = {
      character: { title: edit ? "Editar personagem" : "Novo personagem", eyebrow: "FICHA DE PERSONAGEM", submit: edit ? "Salvar alterações" : "Salvar ficha" },
      item: { title: edit ? "Editar item" : "Novo item", eyebrow: "ACERVO DA AVENTURA", submit: edit ? "Salvar alterações" : "Salvar item" },
      timer: { title: edit ? "Editar cronômetro" : "Novo cronômetro", eyebrow: "CONTROLE DA SESSÃO", submit: edit ? "Salvar alterações" : "Criar cronômetro" }
    };
    const copy = titles[kind];
    $("#modal-title").textContent = copy.title;
    $("#modal-eyebrow").textContent = copy.eyebrow;
    $("#modal-submit").textContent = copy.submit;
    $("#modal-body").innerHTML = kind === "character" ? characterForm(existing || {})
      : kind === "item" ? itemForm(existing || {})
      : timerForm(existing);
    bindDropzoneEvents();
    $("#modal-backdrop").hidden = false;
    document.body.classList.add("modal-open");
    $("#modal-body input:not([type=hidden]), #modal-body textarea").focus();
  }

  function imageDropzone(id, title, helper, image) {
    return `<div class="image-dropzone ${image ? "has-image" : ""}" data-dropzone="${id}" tabindex="0" role="button" aria-label="${title}. Clique ou arraste uma imagem.">
      ${imageMarkup(image, title, "dropzone-preview")}
      <span class="dropzone-copy"><strong>${title}</strong><small>${helper}</small><small class="dropzone-action">Clique para escolher ou solte a imagem aqui</small></span>
      <input type="file" accept="image/*" data-image-input="${id}" hidden>
    </div>`;
  }

  function characterForm(character = {}) {
    return `<div class="form-grid">
      <div class="form-field full-field"><label>Imagem de perfil</label>${imageDropzone("profile-image", "Adicionar retrato", "PNG, JPG ou WEBP", character.image || "")}<input type="hidden" name="image" value="${escapeHtml(character.image || "")}"></div>
      <div class="form-field"><label for="field-name">Nome do personagem <b>*</b></label><input id="field-name" name="name" required maxlength="60" placeholder="Ex.: Lyra Ventofrio" value="${escapeHtml(character.name || "")}"></div>
      <div class="form-field"><label for="field-role">Classe ou função</label><input id="field-role" name="role" maxlength="60" placeholder="Ex.: Druida, Guardião..." value="${escapeHtml(character.role || "")}"></div>
      <div class="form-field"><label for="field-defense">Defesa</label><input id="field-defense" name="defense" type="number" min="0" max="999" placeholder="12" value="${escapeHtml(character.defense ?? "")}"></div>
      <div class="form-field"></div>
      <div class="form-field"><label for="field-health">Vida atual</label><input id="field-health" name="health" type="number" min="0" max="99999" value="${escapeHtml(character.health ?? 20)}"></div>
      <div class="form-field"><label for="field-health-max">Vida máxima</label><input id="field-health-max" name="healthMax" type="number" min="1" max="99999" value="${escapeHtml(character.healthMax ?? 20)}"></div>
      <div class="form-field"><label for="field-mana">Mana atual</label><input id="field-mana" name="mana" type="number" min="0" max="99999" value="${escapeHtml(character.mana ?? 10)}"></div>
      <div class="form-field"><label for="field-mana-max">Mana máxima</label><input id="field-mana-max" name="manaMax" type="number" min="1" max="99999" value="${escapeHtml(character.manaMax ?? 10)}"></div>
      <div class="form-field full-field"><label for="field-equipment">Equipamentos</label><textarea id="field-equipment" name="equipment" rows="3" maxlength="500" placeholder="Ex.: cajado de carvalho, manto élfico...">${escapeHtml(character.equipment || "")}</textarea><small class="field-hint">Separe os equipamentos por vírgula ou linha.</small></div>
    </div>`;
  }

  function itemForm(item = {}) {
    return `<div class="form-grid">
      <div class="form-field full-field"><label>Imagem do item</label>${imageDropzone("item-image", "Adicionar imagem do item", "Mostre como é esse objeto", item.image || "")}<input type="hidden" name="image" value="${escapeHtml(item.image || "")}"></div>
      <div class="form-field"><label for="field-name">Nome do item <b>*</b></label><input id="field-name" name="name" required maxlength="80" placeholder="Ex.: Amuleto da Aurora" value="${escapeHtml(item.name || "")}"></div>
      <div class="form-field"><label for="field-category">Tipo ou raridade</label><input id="field-category" name="category" maxlength="40" placeholder="Ex.: Artefato raro" value="${escapeHtml(item.category || "")}"></div>
      <div class="form-field full-field"><label for="field-description">Descrição do item</label><textarea id="field-description" name="description" rows="5" maxlength="1200" placeholder="Descreva a aparência, a história ou os poderes deste objeto...">${escapeHtml(item.description || "")}</textarea><small class="field-hint">Inclua pistas, efeitos ou a história que os jogadores podem descobrir.</small></div>
    </div>`;
  }

  function timerForm(timer = {}) {
    const total = timer ? Number(timer.duration || timer.remaining || 0) : 0;
    return `<div class="form-grid timer-form-grid">
      <div class="form-field full-field"><label for="field-name">Nome do cronômetro <b>*</b></label><input id="field-name" name="name" required maxlength="60" placeholder="Ex.: Fuga da masmorra" value="${escapeHtml(timer?.name || "")}"></div>
      <div class="form-field"><label for="field-minutes">Minutos</label><input id="field-minutes" name="minutes" type="number" min="0" max="999" value="${Math.floor(total / 60)}"></div>
      <div class="form-field"><label for="field-seconds">Segundos</label><input id="field-seconds" name="seconds" type="number" min="0" max="59" value="${total % 60}"></div>
      <p class="field-hint full-field">O cronômetro começa pausado. Você pode iniciar e pausar a qualquer momento.</p>
    </div>`;
  }

  function closeModal() {
    $("#modal-backdrop").hidden = true;
    document.body.classList.remove("modal-open");
    $("#entity-form").reset();
    modalKind = null;
    editingId = null;
  }

  async function imageToDataUrl(file) {
    if (!file || !file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");
    if (file.size > 12 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 12 MB.");
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      reader.readAsDataURL(file);
    });
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 900 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) return reject(new Error("Não foi possível processar a imagem."));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.onerror = () => reject(new Error("O arquivo não é uma imagem válida."));
      image.src = source;
    });
  }

  function bindDropzoneEvents() {
    $$("[data-dropzone]", $("#modal-body")).forEach(zone => {
      const input = $("[data-image-input]", zone);
      const useFile = async file => {
        try {
          const dataUrl = await imageToDataUrl(file);
          const field = $(`input[name="image"]`, $("#modal-body"));
          field.value = dataUrl;
          const image = $(".dropzone-preview", zone);
          image.outerHTML = `<img class="dropzone-preview" src="${dataUrl}" alt="Prévia da imagem">`;
          zone.classList.add("has-image");
        } catch (error) {
          showToast(error.message);
        }
      };
      zone.addEventListener("click", event => {
        if (!event.target.closest("input")) input.click();
      });
      zone.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          input.click();
        }
      });
      input.addEventListener("change", () => {
        if (input.files?.[0]) useFile(input.files[0]);
        input.value = "";
      });
      zone.addEventListener("dragover", event => {
        event.preventDefault();
        zone.classList.add("drag-over");
      });
      zone.addEventListener("dragleave", event => {
        if (!zone.contains(event.relatedTarget)) zone.classList.remove("drag-over");
      });
      zone.addEventListener("drop", event => {
        event.preventDefault();
        zone.classList.remove("drag-over");
        if (event.dataTransfer.files[0]) useFile(event.dataTransfer.files[0]);
      });
    });
  }

  function submitForm(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (modalKind === "character") {
      const healthMax = Number(data.healthMax) || 1;
      const manaMax = Number(data.manaMax) || 1;
      const character = {
        id: editingId || makeId(), name: data.name.trim(), role: data.role.trim(),
        defense: data.defense, health: Math.min(Number(data.health) || 0, healthMax), healthMax,
        mana: Math.min(Number(data.mana) || 0, manaMax), manaMax, equipment: data.equipment.trim(),
        image: data.image, updatedAt: new Date().toISOString()
      };
      upsert(state.characters, character);
      showToast(editingId ? "Ficha atualizada." : "Personagem adicionado à mesa.");
    } else if (modalKind === "item") {
      upsert(state.items, {
        id: editingId || makeId(), name: data.name.trim(), category: data.category.trim(),
        description: data.description.trim(), image: data.image, updatedAt: new Date().toISOString()
      });
      showToast(editingId ? "Item atualizado." : "Item adicionado ao acervo.");
    } else if (modalKind === "timer") {
      const duration = Math.max(0, (Number(data.minutes) || 0) * 60 + (Number(data.seconds) || 0));
      const timer = { id: editingId || makeId(), name: data.name.trim(), duration, remaining: duration };
      if (editingId) stopTimer(editingId);
      upsert(state.timers, timer);
      showToast(editingId ? "Cronômetro atualizado." : "Cronômetro criado.");
    }
    closeModal();
    saveState();
    render();
  }

  function upsert(list, entry) {
    const index = list.findIndex(existing => existing.id === entry.id);
    if (index >= 0) list[index] = entry;
    else list.push(entry);
  }

  function startTimer(id) {
    if (timers.has(id)) return;
    const timer = state.timers.find(entry => entry.id === id);
    if (!timer || timer.remaining <= 0) return;
    const interval = setInterval(() => {
      timer.remaining = Math.max(0, timer.remaining - 1);
      timers.set(id, { interval, remaining: timer.remaining });
      $$(`[data-timer-clock="${CSS.escape(id)}"]`).forEach(clock => {
        clock.textContent = formatTime(timer.remaining);
      });
      renderPdfTimers();
      if (timer.remaining <= 0) {
        stopTimer(id);
        showToast(`Tempo esgotado: ${timer.name}`);
        render();
      }
      saveState();
    }, 1000);
    timers.set(id, { interval, remaining: timer.remaining });
    render();
  }

  function stopTimer(id) {
    const running = timers.get(id);
    if (!running) return;
    clearInterval(running.interval);
    timers.delete(id);
  }

  function toggleTimer(id) {
    if (timers.has(id)) {
      stopTimer(id);
      saveState();
      render();
    } else startTimer(id);
  }

  function resetTimer(id) {
    stopTimer(id);
    const timer = state.timers.find(entry => entry.id === id);
    if (!timer) return;
    timer.remaining = timer.duration;
    saveState();
    render();
  }

  function deleteEntry(kind, id) {
    if (kind === "timer") stopTimer(id);
    const list = state[`${kind}s`];
    const index = list.findIndex(entry => entry.id === id);
    if (index < 0 || !window.confirm("Excluir este registro? Esta ação não pode ser desfeita.")) return;
    list.splice(index, 1);
    saveState();
    render();
    showToast("Registro excluído.");
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `cronicas-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Backup JSON exportado.");
  }

  async function importData(file) {
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!imported || !Array.isArray(imported.characters) || !Array.isArray(imported.items) || !Array.isArray(imported.timers)) {
        throw new Error("O arquivo não possui um formato de backup válido.");
      }
      if (!window.confirm("Importar substituirá os dados atuais desta campanha. Deseja continuar?")) return;
      state.characters = imported.characters;
      state.items = imported.items;
      state.timers = imported.timers.map(timer => ({ ...timer, remaining: Math.max(0, Number(timer.remaining ?? timer.duration) || 0), duration: Math.max(0, Number(timer.duration) || 0) }));
      saveState();
      render();
      showToast("Backup importado com sucesso.");
    } catch (error) {
      console.error("Falha ao importar o backup:", error);
      showToast(error instanceof SyntaxError ? "O arquivo selecionado não contém JSON válido." : error.message);
    } finally {
      $("#import-file").value = "";
    }
  }

  document.addEventListener("click", event => {
    const nav = event.target.closest("[data-view]");
    if (nav?.dataset.view === "library") return toggleBookReader();
    if (nav) return navigate(nav.dataset.view);
    const go = event.target.closest("[data-go]");
    if (go) return navigate(go.dataset.go);
    const action = event.target.closest("[data-action]");
    if (action) return openModal(action.dataset.action.replace("new-", ""));
    if (event.target.closest("#quick-add-character")) return openModal("character");
    if (event.target.closest("#quick-add-timer")) return openModal("timer");
    if (event.target.closest("#export-button, #header-export")) return exportData();
    if (event.target.closest("#import-button")) return $("#import-file").click();
    const edit = event.target.closest("[data-edit]");
    if (edit) return openModal(edit.dataset.edit, edit.dataset.id);
    const toggle = event.target.closest("[data-timer-toggle]");
    if (toggle) return toggleTimer(toggle.dataset.timerToggle);
    const reset = event.target.closest("[data-timer-reset]");
    if (reset) return resetTimer(reset.dataset.timerReset);
    const remove = event.target.closest("[data-timer-delete]");
    if (remove) return deleteEntry("timer", remove.dataset.timerDelete);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !$("#modal-backdrop").hidden) closeModal();
    else if (event.key === "Escape" && !$("#pdf-reader").hidden) toggleBookReader(false);
    if (event.key === "Enter" && event.target.matches(".item-tile")) openModal("item", event.target.dataset.id);
  });

  $("#pdf-choose-button").addEventListener("click", () => $("#pdf-file-input").click());
  $("#pdf-empty-choose").addEventListener("click", () => $("#pdf-file-input").click());
  $("#pdf-file-input").addEventListener("change", event => addBook(event.target.files?.[0]));
  $("#pdf-remove-button").addEventListener("click", removeBook);
  $("#pdf-reader-close").addEventListener("click", () => toggleBookReader(false));
  $("#pdf-retry-button").addEventListener("click", () => {
    releaseBookViewer();
    if (window.pdfjsLib) showBookViewer();
    else window.location.reload();
  });
  $("#pdf-previous-page").addEventListener("click", () => {
    if (pdfPageNumber > 1) {
      pdfPageNumber -= 1;
      renderPdfPage();
    }
  });
  $("#pdf-next-page").addEventListener("click", () => {
    if (pdfDocument && pdfPageNumber < pdfDocument.numPages) {
      pdfPageNumber += 1;
      renderPdfPage();
    }
  });
  $("#pdf-page-input").addEventListener("change", event => goToPdfPage(event.currentTarget.value));
  $("#pdf-page-input").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      goToPdfPage(event.currentTarget.value);
      event.currentTarget.blur();
    }
  });
  $("#pdf-zoom-out").addEventListener("click", () => {
    pdfZoom = Math.max(0.5, pdfZoom - 0.1);
    renderPdfPage();
  });
  $("#pdf-zoom-in").addEventListener("click", () => {
    pdfZoom = Math.min(2.5, pdfZoom + 0.1);
    renderPdfPage();
  });
  $("#pdf-reader-content").addEventListener("dragover", event => event.preventDefault());
  $("#pdf-reader-content").addEventListener("drop", event => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) addBook(file);
  });

  $("#entity-form").addEventListener("submit", submitForm);
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-cancel").addEventListener("click", closeModal);
  $("#modal-backdrop").addEventListener("click", event => {
    if (event.target === $("#modal-backdrop")) closeModal();
  });
  $("#import-file").addEventListener("change", event => importData(event.target.files?.[0]));
  $("#overview-character-list").addEventListener("click", event => {
    const edit = event.target.closest("[data-edit]");
    if (edit) openModal("character", edit.dataset.id);
  });

  $("#current-date").textContent = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "numeric", month: "long"
  }).format(new Date()).toLocaleUpperCase("pt-BR");
  render();
  loadBook();
})();