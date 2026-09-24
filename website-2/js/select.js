/*
 * A styleable dropdown for every <select class="field"> on the page.
 *
 * A native select's popup is drawn by the operating system, so no CSS reaches
 * inside it. This hides the select and drives it from a button and a listbox
 * that are page markup, and can therefore be rounded and animated like the
 * operator picker beside them.
 *
 * The select itself stays in the form, keeps its name and its value, and is
 * what the browser submits, so FormData, form.reset() and every `change`
 * listener written against these selects keep working.
 *
 * The button carries the combobox role, the list carries listbox and option
 * roles, and the arrow keys, Home, End, Enter, Escape and Tab behave as they do
 * in a real select. What is lost is the OS picker on a phone, which is better
 * on touch than any of this: delete this file's <script> tag and the selects go
 * back to being native, with nothing else to change.
 */
(function () {
    "use strict";

    const selects = document.querySelectorAll("select.field");
    if (!selects.length) {
        return;
    }

    // Only one open at a time, so opening a second closes the first.
    let openInstance = null;

    Array.prototype.forEach.call(selects, enhance);

    document.addEventListener("click", function (event) {
        if (openInstance && !openInstance.root.contains(event.target)) {
            openInstance.close();
        }
    });

    function enhance(select) {
        const wrapper = document.createElement("div");
        // Sizing utilities (`lg:w-60` and friends) move to the wrapper; `field`
        // is the look of the control itself and moves to the button.
        wrapper.className =
            "select " +
            select.className
                .split(/\s+/)
                .filter(function (name) {
                    return name && name !== "field";
                })
                .join(" ");

        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select);
        select.classList.add("select__native");
        select.setAttribute("tabindex", "-1");
        select.setAttribute("aria-hidden", "true");

        const button = document.createElement("button");
        button.type = "button";
        button.className = "field select__button";
        button.setAttribute("aria-haspopup", "listbox");
        button.setAttribute("aria-expanded", "false");

        // The label that pointed at the select has to point at the button now,
        // or clicking it focuses something invisible.
        const label = select.id ? document.querySelector('label[for="' + select.id + '"]') : null;
        if (label) {
            button.id = select.id + "-button";
            label.setAttribute("for", button.id);
        }

        const text = document.createElement("span");
        text.className = "select__text";
        button.appendChild(text);

        const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        chevron.setAttribute("class", "select__chevron");
        chevron.setAttribute("viewBox", "0 0 24 24");
        chevron.setAttribute("fill", "none");
        chevron.setAttribute("stroke", "currentColor");
        chevron.setAttribute("stroke-width", "2");
        chevron.setAttribute("aria-hidden", "true");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("d", "M6 9l6 6 6-6");
        chevron.appendChild(path);
        button.appendChild(chevron);

        const list = document.createElement("ul");
        list.className = "select__panel";
        list.setAttribute("role", "listbox");
        if (label) {
            list.setAttribute("aria-label", label.textContent.trim());
        }

        wrapper.appendChild(button);
        wrapper.appendChild(list);

        let active = -1;
        const instance = { root: wrapper, close: close };

        function options() {
            return Array.prototype.slice.call(list.children);
        }

        // Rebuilt from the select's own options, so one filled in later from
        // the database is not left showing an empty list.
        function build() {
            while (list.firstChild) {
                list.removeChild(list.firstChild);
            }
            Array.prototype.forEach.call(select.options, function (option, index) {
                const item = document.createElement("li");
                item.className = "select__option";
                item.setAttribute("role", "option");
                item.dataset.index = String(index);
                item.textContent = option.textContent;
                item.setAttribute("aria-selected", String(index === select.selectedIndex));
                // mousedown, not click: the button's blur would close the list
                // before a click could land.
                item.addEventListener("mousedown", function (event) {
                    event.preventDefault();
                    choose(index);
                });
                list.appendChild(item);
            });
            syncText();
        }

        function syncText() {
            const option = select.options[select.selectedIndex];
            text.textContent = option ? option.textContent : "";
            // A placeholder value reads as lighter, the way a native select's
            // empty state does.
            button.classList.toggle("is-empty", !select.value);
            options().forEach(function (item, index) {
                item.setAttribute("aria-selected", String(index === select.selectedIndex));
            });
        }

        function highlight(index) {
            const items = options();
            if (!items.length) {
                return;
            }
            active = (index + items.length) % items.length;
            items.forEach(function (item, i) {
                item.classList.toggle("is-active", i === active);
                if (i === active && typeof item.scrollIntoView === "function") {
                    item.scrollIntoView({ block: "nearest" });
                }
            });
        }

        function open() {
            if (openInstance && openInstance !== instance) {
                openInstance.close();
            }
            openInstance = instance;
            list.classList.add("is-open");
            button.setAttribute("aria-expanded", "true");
            highlight(select.selectedIndex < 0 ? 0 : select.selectedIndex);
        }

        function close() {
            list.classList.remove("is-open");
            button.setAttribute("aria-expanded", "false");
            active = -1;
            if (openInstance === instance) {
                openInstance = null;
            }
        }

        function choose(index) {
            select.selectedIndex = index;
            syncText();
            close();
            button.focus();
            // Setting `selectedIndex` from script fires no event of its own,
            // and the sort, the page size and the command banner listen for it.
            select.dispatchEvent(new Event("change", { bubbles: true }));
        }

        button.addEventListener("click", function () {
            if (list.classList.contains("is-open")) {
                close();
            } else {
                open();
            }
        });

        button.addEventListener("keydown", function (event) {
            const isOpen = list.classList.contains("is-open");

            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!isOpen) {
                    open();
                    return;
                }
                highlight(active + (event.key === "ArrowDown" ? 1 : -1));
                return;
            }
            if (event.key === "Home" || event.key === "End") {
                if (isOpen) {
                    event.preventDefault();
                    highlight(event.key === "Home" ? 0 : options().length - 1);
                }
                return;
            }
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (isOpen && active >= 0) {
                    choose(active);
                } else {
                    open();
                }
                return;
            }
            if (event.key === "Escape") {
                close();
                return;
            }
            if (event.key === "Tab") {
                // Moving on is a close, not a choice.
                close();
            }
        });

        // Anything that changes the select from elsewhere, a chip being removed
        // or the form being reset, has to be reflected here.
        select.addEventListener("change", syncText);

        const parentForm = select.form;
        if (parentForm) {
            parentForm.addEventListener("reset", function () {
                // After the browser has cleared the fields, not before.
                window.setTimeout(syncText, 0);
            });
        }

        if ("MutationObserver" in window) {
            new MutationObserver(build).observe(select, { childList: true });
        }

        build();
    }
})();
