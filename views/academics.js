import {
  listClasses,
  addClass,
  addStreamToClass,
  renameStream,
  removeStreamFromClass,
  deleteClass,
  seedDefaultsIfEmpty,
} from "../js/services/academic.service.js";
import { openModal } from "../js/components/modal.js";
import { el, toast } from "../js/utils.js";

let classes = [];

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  classes = await listClasses();

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [el("h1", {}, "Classes & Streams"), el("p", {}, `${classes.length} grade(s) configured`)]),
      el("button", { class: "btn btn--primary", id: "new-grade-btn" }, "+ Add Grade"),
    ])
  );

  const gridWrap = el("div", {});
  wrap.append(gridWrap);
  renderGrid(gridWrap, profile);

  setTimeout(() => {
    document.getElementById("new-grade-btn")?.addEventListener("click", () => openGradeForm(profile));
  });

  return wrap;
}

function renderGrid(container, profile) {
  container.innerHTML = "";
  if (!classes.length) {
    container.append(
      el("div", { class: "empty-state" }, [
        el("h3", {}, "No grades yet"),
        el("p", {}, "Click '+ Add Grade' to set up your first grade and its streams."),
      ])
    );
    return;
  }

  const grid = el("div", { class: "card-grid" });
  for (const c of classes) {
    const card = el("div", { class: "grade-card" });
    card.append(
      el("div", { class: "grade-card__header" }, [
        el("h3", {}, c.grade),
        el("div", { class: "grade-card__actions" }, [
          el("button", { class: "btn btn--ghost btn--sm", onClick: () => openDeleteConfirm(profile, c) }, "Delete"),
        ]),
      ])
    );

    const chipList = el("div", { class: "chip-list" });
    for (const stream of c.streams || []) {
      const chip = el("span", { class: "chip" }, [
        el("span", { onClick: () => openRenameStream(profile, c, stream) }, stream),
        el("span", { class: "chip__remove", title: `Remove ${stream}`, onClick: () => confirmRemoveStream(profile, c, stream) }, "×"),
      ]);
      chipList.append(chip);
    }
    if (!(c.streams || []).length) {
      chipList.append(el("span", { class: "text-muted" }, "No streams yet"));
    }
    card.append(chipList);

    const addStreamRow = el("form", { style: "display:flex; gap:8px; margin-top:12px;" });
    const input = el("input", { placeholder: "New stream e.g. Yellow", style: "flex:1; padding:8px; border:1px solid var(--color-line); border-radius:6px;" });
    addStreamRow.append(input, el("button", { type: "submit", class: "btn btn--ghost btn--sm" }, "+ Stream"));
    addStreamRow.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      try {
        await addStreamToClass(profile.uid, c.id, name);
        toast(`${name} added to ${c.grade}.`, "success");
        await refresh(profile);
      } catch (err) {
        toast(err.message || "Could not add stream.", "error");
      }
    });
    card.append(addStreamRow);

    grid.append(card);
  }
  container.append(grid);
}

async function refresh(profile) {
  classes = await listClasses();
  const container = document.querySelector(".card-grid")?.parentElement;
  if (container) renderGrid(container, profile);
}

function openGradeForm(profile) {
  const body = el("form", {});
  const streamsPreview = el("div", { class: "chip-list", style: "margin-bottom:12px;" });
  const pendingStreams = [];

  function redrawPreview() {
    streamsPreview.innerHTML = "";
    pendingStreams.forEach((s, idx) => {
      streamsPreview.append(
        el("span", { class: "chip" }, [
          s,
          el("span", { class: "chip__remove", onClick: () => { pendingStreams.splice(idx, 1); redrawPreview(); } }, "×"),
        ])
      );
    });
  }

  body.append(
    el("div", { class: "field" }, [el("label", {}, "Grade Name"), el("input", { id: "g-grade", placeholder: "e.g. Grade 9" })]),
    el("div", { class: "field" }, [
      el("label", {}, "Streams"),
      streamsPreview,
      el("div", { style: "display:flex; gap:8px;" }, [
        el("input", { id: "g-stream-input", placeholder: "e.g. Blue", style: "flex:1;" }),
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          onClick: () => {
            const v = document.getElementById("g-stream-input").value.trim();
            if (!v) return;
            pendingStreams.push(v);
            document.getElementById("g-stream-input").value = "";
            redrawPreview();
          },
        }, "Add"),
      ]),
    ]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, "Create grade")
  );

  const close = openModal("Add Grade", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const grade = document.getElementById("g-grade").value.trim();
    if (!grade) return toast("Grade name is required.", "error");
    try {
      await addClass(profile.uid, grade, pendingStreams);
      toast(`${grade} created.`, "success");
      close();
      await refresh(profile);
    } catch (err) {
      toast(err.message || "Could not create grade.", "error");
    }
  });
}

function openRenameStream(profile, cls, streamName) {
  const body = el("form", {});
  body.append(
    el("div", { class: "field" }, [el("label", {}, `Rename stream in ${cls.grade}`), el("input", { id: "rs-name", value: streamName })]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, "Save")
  );
  const close = openModal(`${cls.grade} — ${streamName}`, body);
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newName = document.getElementById("rs-name").value.trim();
    if (!newName || newName === streamName) return close();
    try {
      await renameStream(profile.uid, cls.id, streamName, newName);
      toast("Stream renamed.", "success");
      close();
      await refresh(profile);
    } catch (err) {
      toast(err.message || "Could not rename stream.", "error");
    }
  });
}

function confirmRemoveStream(profile, cls, streamName) {
  const body = el("div", {});
  body.append(
    el("p", {}, `Remove "${streamName}" from ${cls.grade}? This can't be undone.`),
    el("div", { style: "display:flex; gap:8px; margin-top:16px;" }, [
      el("button", { class: "btn btn--danger", onClick: async () => {
        try {
          await removeStreamFromClass(profile.uid, cls.id, streamName);
          toast("Stream removed.", "success");
          close();
          await refresh(profile);
        } catch (err) {
          toast(err.message || "Could not remove stream.", "error");
        }
      } }, "Remove"),
      el("button", { class: "btn btn--ghost", onClick: () => close() }, "Cancel"),
    ])
  );
  const close = openModal("Remove Stream", body);
}

function openDeleteConfirm(profile, cls) {
  const body = el("div", {});
  body.append(
    el("p", {}, `Delete ${cls.grade} and all its streams? This can't be undone.`),
    el("div", { style: "display:flex; gap:8px; margin-top:16px;" }, [
      el("button", { class: "btn btn--danger", onClick: async () => {
        try {
          await deleteClass(profile.uid, cls.id);
          toast(`${cls.grade} deleted.`, "success");
          close();
          await refresh(profile);
        } catch (err) {
          toast(err.message || "Could not delete grade.", "error");
        }
      } }, "Delete"),
      el("button", { class: "btn btn--ghost", onClick: () => close() }, "Cancel"),
    ])
  );
  const close = openModal("Delete Grade", body);
}

export function init() {}
