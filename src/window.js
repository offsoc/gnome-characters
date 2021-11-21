// -*- Mode: js; indent-tabs-mode: nil; c-basic-offset: 4; tab-width: 4 -*-
//
// Copyright (c) 2013 Giovanni Campagna <scampa.giovanni@gmail.com>
//
// Redistribution and use in source and binary forms, with or without
//  modification, are permitted provided that the following conditions are met:
//   * Redistributions of source code must retain the above copyright
//     notice, this list of conditions and the following disclaimer.
//   * Redistributions in binary form must reproduce the above copyright
//     notice, this list of conditions and the following disclaimer in the
//     documentation and/or other materials provided with the distribution.
//   * Neither the name of the GNOME Foundation nor the
//     names of its contributors may be used to endorse or promote products
//     derived from this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
// ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
// WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY
// DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
// (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
// ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
// SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

const {Adw, Gio, GLib, GObject, Gtk } = imports.gi;

const {Sidebar, MainCategories} = imports.categoryList;
const {CharacterDialog} = imports.characterDialog;
const {CharactersView, FontFilter, RecentCharacterListView} = imports.charactersView;
const {MenuPopover} = imports.menu;
const Gettext = imports.gettext;

const Main = imports.main;
const Util = imports.util;

var MainWindow = GObject.registerClass({
    Template: 'resource:///org/gnome/Characters/window.ui',
    InternalChildren: [
        'main-headerbar', 'search-active-button',
        'search-bar', 'search-entry', 'back-button',
        'menuPopover', 'container', 'sidebar',
        'leaflet', 'mainStack', 'recentBox', 'windowTitle',
        'charactersView',
    ],
    Properties: {
        'search-active': GObject.ParamSpec.boolean(
            'search-active', '', '',
            GObject.ParamFlags.READABLE | GObject.ParamFlags.WRITABLE, false),
        'max-recent-characters': GObject.ParamSpec.uint(
            'max-recent-characters', '', '',
            GObject.ParamFlags.READABLE | GObject.ParamFlags.WRITABLE,
            0, GLib.MAXUINT32, 100)
    },
}, class MainWindow extends Adw.ApplicationWindow {
    _init(application) {
        super._init({ application, title: GLib.get_application_name() });

        this._searchActive = false;
        this._searchKeywords = [];

        this._fontFilter = new FontFilter();
        this._filterFontFamily = null;
        this._characterLists = {};
        this._recentCharacterLists = {};
        this._charactersView.setFontFilter(this._fontFilter);
        this._charactersView.connect('character-selected', (widget, uc) => this._handleCharacterSelected(widget, uc));


        this._sidebar.list.connect('row-selected', (sidebar, row) => {
            this.setPage(row);
            this._updateTitle(row.title);
            this._leaflet.navigate(Adw.NavigationDirection.FORWARD);
        });

        let characterList;


        /*characterList = this._createCharacterList(
            'search-result', _('Search Result Character List'));
        // FIXME: Can't use GtkContainer.child_get_property.
        characterList.title = _("Search Result");
        this._mainStack.add_named(characterList, 'search-result');
        */
        // FIXME: Can't use GSettings.bind with 'as' from Gjs
        let recentCharacters = Main.settings.get_value('recent-characters');
        this.recentCharacters = recentCharacters.get_strv();
        this._maxRecentCharacters = 100;
        Main.settings.bind('max-recent-characters', this,
                           'max-recent-characters',
                           Gio.SettingsBindFlags.DEFAULT);


        Util.initActions(this,
                         [{ name: 'about',
                            activate: this._about },
                          { name: 'search-active',
                            activate: this._toggleSearch,
                            parameter_type: new GLib.VariantType('b'),
                            state: new GLib.Variant('b', false) },
                          { name: 'find',
                            activate: this._find },
                          { name: 'category',
                            activate: this._category,
                            parameter_type: new GLib.VariantType('s'),
                            state: new GLib.Variant('s', 'emoji-smileys') },
                          { name: 'character',
                            activate: this._character,
                            parameter_type: new GLib.VariantType('s') },
                          { name: 'filter-font',
                            activate: this._filterFont,
                            parameter_type: new GLib.VariantType('s')
                            },
                            { 
                                name: 'show-primary-menu',
                                activate: this._togglePrimaryMenu,
                                state: new GLib.Variant('b', false),
                            }]);

        this.bind_property('search-active', this._search_active_button, 'active',
                           GObject.BindingFlags.SYNC_CREATE |
                           GObject.BindingFlags.BIDIRECTIONAL);
        this.bind_property('search-active',
                           this._search_bar,
                           'search-mode-enabled',
                           GObject.BindingFlags.SYNC_CREATE |
                           GObject.BindingFlags.BIDIRECTIONAL);
        this._search_bar.connect_entry(this._search_entry);
        this._search_entry.connect('search-changed', (entry) => this._handleSearchChanged(entry));

        this._back_button.connect('clicked', () => {
            this._leaflet.navigate(Adw.NavigationDirection.BACK);
        });

        // Due to limitations of gobject-introspection wrt GdkEvent
        // and GdkEventKey, this needs to be a signal handler
        // TODO: use EventControllerKey
        //this.connect('key-press-event', (self, event) => this._handleKeyPress(self, event));
    }

    vfunc_map() {
        super.vfunc_map();
        this._selectFirstSubcategory();
    }

    _togglePrimaryMenu(action) {
        let state = action.get_state().get_boolean();
        action.set_state(GLib.Variant.new_boolean(!state));
    }

    // Select the first subcategory which contains at least one character.
    _selectFirstSubcategory() {
        if (this.recentCharacters.length !== 0) {
            this._sidebar.selectRowByName('recent');
        } else {
            this._sidebar.selectRowByName('smileys');
        }
    }

    get search_active() {
        return this._searchActive;
    }

    set search_active(v) {
        if (this._searchActive == v)
            return;

        this._searchActive = v;

        if (this._searchActive) {
            let categoryList = this._sidebar.selectedList.list;
            categoryList.unselect_all();
            this._updateTitle(_("Search Result"));
        } else {
            this._sidebar.restorePreviousSelection();
        }

        this.notify('search-active');
    }

    _handleSearchChanged(entry) {
        const text = entry.get_text().replace(/^\s+|\s+$/g, '');
        let keywords = text == '' ? [] : text.split(/\s+/);
        keywords = keywords.map(x => x.toUpperCase());
        if (keywords != this._searchKeywords) {
            this.cancelSearch();
            this._searchKeywords = keywords;
            if (this._searchKeywords.length > 0)
                this.searchByKeywords(this._searchKeywords);
        }
        return true;
    }

    _handleKeyPress(self, event) {
        if (this._menuPopover.visible)
            return false;
        return this._search_bar.handle_event(event);
    }

    _about() {
        const aboutDialog = new Gtk.AboutDialog(
            { artists: [ 'Allan Day <allanpday@gmail.com>',
                         'Jakub Steiner <jimmac@gmail.com>' ],
              authors: [ 'Daiki Ueno <dueno@src.gnome.org>',
                         'Giovanni Campagna <scampa.giovanni@gmail.com>' ],
              // TRANSLATORS: put your names here, one name per line.
              translator_credits: _("translator-credits"),
              program_name: _("GNOME Characters"),
              comments: _("Character Map"),
              copyright: 'Copyright 2014-2018 Daiki Ueno',
              license_type: Gtk.License.GPL_2_0,
              logo_icon_name: Main.application_id,
              version: pkg.version,
              website: 'https://wiki.gnome.org/Apps/Characters',
              wrap_license: true,
              modal: true,
              transient_for: this
            });

        aboutDialog.show();
    }

    _updateTitle(title) {
        if (this.filterFontFamily) {
            this._windowTitle.title =
                _("%s (%s only)").format(Gettext.gettext(title),
                                         this.filterFontFamily);
        } else {
            this._windowTitle.title = Gettext.gettext(title);
        }
    }

    _character(action, v) {
        const [uc, length] = v.get_string();
        this.addToRecent(uc);
    }

    _filterFont(action, v) {
        let [family, length] = v.get_string();
        if (family == 'None')
            family = null;
        this.filterFontFamily = family;
        //this._updateTitle(this._stack.visible_child.title);
        this._menuPopover.hide();
    }

    _find() {
        this.search_active = !this.search_active;
    }

    setSearchKeywords(keywords) {
        this.search_active = keywords.length > 0;
        this._search_entry.set_text(keywords.join(' '));
    }

    get max_recent_characters() {
        return this._maxRecentCharacters;
    }

    set max_recent_characters(v) {
        this._maxRecentCharacters = v;
        if (this.recentCharacters.length > this._maxRecentCharacters)
            this.recentCharacters = this.recentCharacters.slice(
                0, this._maxRecentCharacters);
    }

    get filterFontFamily() {
        return this._filterFontFamily;
    }

    set filterFontFamily(family) {
        this._filterFontFamily = family;
        this._fontFilter.setFilterFont(this._filterFontFamily);
    }

    _createRecentCharacterList(name, accessible_name, category) {
        const characterList = new RecentCharacterListView(category, this._fontFilter);
        //characterList.get_accessible().accessible_name = accessible_name;
        characterList.connect('character-selected', (widget, uc) => this._handleCharacterSelected(widget, uc));

        this._characterLists[name] = characterList;
        return characterList;
    }

    searchByKeywords(keywords) {
        this._mainStack.visible_child_name = 'search-result';
        this.visible_child.searchByKeywords(keywords);
    }

    cancelSearch() {
        const characterList = this.mainStack.get_child_by_name('search-result');
        characterList.cancelSearch();
    }

    setPage(pageRow) {
        if (pageRow.name === 'recent') {
            if (this.recentCharacters.length === 0)
                this._mainStack.visible_child_name = 'empty-recent';
            else {
                this._charactersView.setCharacters(this.recentCharacters);
                this._mainStack.visible_child_name = 'recent';
            }
        } else {
            this._charactersView.searchByCategory(pageRow.category);
            this._mainStack.visible_child_name = 'character-list';
            //this._charactersView.model = pageRow.model;
        }
    }

    addToRecent(uc) {
        if (this.recentCharacters.indexOf(uc) < 0) {
            this.recentCharacters.unshift(uc);
            if (this.recentCharacters.length > this._maxRecentCharacters)
                this.recentCharacters = this.recentCharacters.slice(
                    0, this._maxRecentCharacters);
            Main.settings.set_value(
                'recent-characters',
                GLib.Variant.new_strv(this.recentCharacters));
        }
    }

    _addToRecent(widget, uc) {
        this.addToRecent(uc);
    }

    _handleCharacterSelected(widget, uc) {
        const dialog = new CharacterDialog(uc, this._fontFilter.fontDescription);
        dialog.set_modal(true);
        dialog.set_transient_for(this.get_root());
        dialog.connect('character-copied', (widget, uc) => this._addToRecent(widget, uc));
        dialog.show();
    }
});
