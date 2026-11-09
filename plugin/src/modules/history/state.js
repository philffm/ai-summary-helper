// history/state.js — what the History screen's modules share (articleManager.js, history/export.js, history/detail.js).
// One object instead of module-level `let`s, because an imported binding cannot be reassigned by the importer.
export const hist = {
    ui: null,                 // the uiManager (toasts, screens)
    detail: null,             // the article open in the detail view
    cached: [],               // not archived: graph, search and the Inbox/Read/Sent tabs read from here
    archived: [],             // archived entries (Archive tab)
    detailChosenAt: 0,        // when an article was last opened (a History reload scheduled before must not bring the list back)
    toolbarEditing: false,    // the detail toolbar is being customized
};
