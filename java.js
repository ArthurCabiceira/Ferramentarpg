(() => {
  "use strict";

  const STORAGE_KEY = "cronicas-mestre-v1";
  const state = loadState();
  const timers = new Map();
  let modalKind = null;
  let editingId = null;
  let toastTimeout = null;

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
    $$(".nav-link[data-view]").forEach(link => link.classList.toggle("active", link.dataset.view === viewName));
    const labels = { overview: "Visão geral", characters: "Personagens", items: "Itens", timers: "Cronômetros" };
    $("#breadcrumb-current").textContent = labels[viewName] || labels.overview;
    window.scrollTo({ top: 0, behavior: "smooth" });
    render();
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
      const clock = $(`[data-timer-clock="${CSS.escape(id)}"]`);
      if (clock) clock.textContent = formatTime(timer.remaining);
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
    if (event.key === "Enter" && event.target.matches(".item-tile")) openModal("item", event.target.dataset.id);
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
})();