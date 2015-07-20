define(function (require, exports, module) {
    'use strict';

    var AppInit = brackets.getModule("utils/AppInit"),
        LanguageManager = brackets.getModule("language/LanguageManager"),
        DocumentManager = brackets.getModule("document/DocumentManager"),
        CommandManager = brackets.getModule('command/CommandManager'),
        Commands = brackets.getModule('command/Commands'),
        EditorManager = brackets.getModule('editor/EditorManager'),
        cm = brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");

    AppInit.htmlReady(function () {
        init();
    });

    function init() {

        indentFolding();
        formatOnSave();
        extraKeys();

        LanguageManager.defineLanguage("gherkin", {
            name: "Gherkin",
            mode: "gherkin",
            fileExtensions: ["feature"],
            lineComment: ["#", "#"]
        });
    }

    function indentFolding() {
        var indentFold;
        cm.helpers.fold._global.some(function (g) {
            if (g.val.toString().match(/^function indentFold/)) {
                indentFold = g.val;
                return true;
            }
        });

        cm.registerGlobalHelper("fold", "indent", function (mode, cm) {
            return mode.name == 'gherkin';
        }, indentFold);
    }

    function formatOnSave() {
        DocumentManager.on('documentSaved',
            function onSave(event, doc) {
                if (doc.__FormatingGherkin)
                    return;

                doc.__FormatingGherkin = true;
                setTimeout(function () {
                    format(doc);
                    setTimeout(function () {
                        delete doc.__FormatingGherkin;
                    }, 2000);
                }, 50);
                //                if (doc.__Saving)
                //                    return;
                //                try {
                //                    doc.addRef();
                //                    doc.__Saving = true;
                //
                //                } finally {
                //                    doc.releaseRef();
                //                    doc.__Saving = false;
                //                }
                //                //                setTimeout(function () {
                //                //                    CommandManager.execute(Commands.FILE_SAVE, {
                //                //                        doc: doc
                //                //                    }).always(function () {
                //                //                        delete doc.__Saving;
                //                //                        doc.releaseRef();
                //                //                    });
                //                //                });
            })
    }

    var GROUP_LINE = /:/,
        BLANK_LINE = /^\s*$/,
        COMMENT_LINE = /^\s*#/,
        TAG_LINE = /^\s*@/,
        DASHED_LINE = /^(\s|\-)*$/,
        STARTING_SPACES = /^\s*/,
        TRAILING_SPACES = /\s*$/;

    function format(document, table_fn) {
        if (document.getLanguage().getId() != 'gherkin')
            return;
        var editor = EditorManager.getCurrentFullEditor();
        var cursorPos = editor.getCursorPos(),
            scrollPos = editor.getScrollPos(),
            unformattedText = document.getText(),
            lines = unformattedText.split('\n'),
            tag_start = -1,
            group_start = -1,
            table;

        analiseRows();
        flush_table(lines.length - 1);

        var formattedText = lines.join('\n');

        if (formattedText != unformattedText)
            document.batchOperation(function () {
                document.setText(formattedText);
                editor.setCursorPos(cursorPos);
                editor.setScrollPos(scrollPos.x, scrollPos.y);
            });

        function analiseRows() {

            lines.forEach(function (line, lineIdx) {

                if (!line) return lines[lineIdx] = '';
                if (BLANK_LINE.test(line)) return blankLine();
                if (DASHED_LINE.test(line)) return dashedLine();
                if (COMMENT_LINE.test(line)) return commentLine();
                if (TAG_LINE.test(line)) return tagLine();
                if (line.indexOf('|') >= 0) return exampleLine('|');
                if (line.indexOf('\u2506') >= 0) return exampleLine('\u2506');
                if (GROUP_LINE.test(line)) return groupLine();

                lines[lineIdx] = '  ' + lines[lineIdx].trim();

                function groupLine() {
                    flush_table(lineIdx - 1);
                    doindent(tag_start, lineIdx, '');
                    group_start = tag_start >= 0 ? tag_start : lineIdx;
                    tag_start = -1;
                }

                function tagLine() {
                    if (tag_start == -1)
                        tag_start = lineIdx;
                    flush_table_example(lineIdx);
                }

                function blankLine() {
                    flush_table_example(lineIdx)
                }

                function dashedLine() {
                    table.dashed.push({
                        lineIdx: lineIdx
                    });
                    flush_table_example(lineIdx);
                }

                function exampleLine(sep) {
                    if (!table)
                        initExamples(sep);
                    else if (!table.error)
                        calcColumnWidth(sep);
                    tag_start = -1;
                }


                function strIndent(s) {
                    var indent = s.match(STARTING_SPACES);
                    return (indent && indent.length && indent[0].length) || 0;
                }

                function initExamples(sep) {

                    doindent(group_start, lineIdx - 1, '  ');
                    var cols = line.split(sep);
                    table = {
                        error: false,
                        table_start: lineIdx,
                        cols: cols.map(function (col) {
                            var h = col.trim();
                            return {
                                indent: strIndent(col),
                                width: h.length,
                                header: h
                            };
                        }),
                        dashed: [],
                        cursorPos: {
                            example_start_lineIdx: null,
                            example_start_tableIdx: null,
                            example_end_lineIdx: null,
                            example_end_tableIdx: null
                        }
                    };
                    table.rows = [{
                        lineIdx: lineIdx,
                        sep: sep,
                        cols: table.cols.map(function (col) {
                            return col.header;
                        })
                    }];
                    group_start = -1;
                }

                function calcColumnWidth(sep) {

                    doindent(group_start, lineIdx, '');
                    var cols = line.split(sep);

                    if (cols.length != table.cols.length)
                        return table.error = {
                            msg: 'Column count mismatch',
                            line: lineIdx
                        };

                    if (!table.cursorPos.lineIdx && !table.cursorPos.example_start_lineIdx) {
                        table.cursorPos.example_start_lineIdx = lineIdx;
                        table.cursorPos.example_start_tableIdx = table.rows.length;
                    }

                    var temp = 0;

                    table.rows.push({
                        lineIdx: lineIdx,
                        sep: sep,
                        cols: cols.map(function (col, idx) {
                            if (table.error)
                                return;

                            var indent = strIndent(col) - table.cols[idx].indent;

                            if (indent < 0)
                                if (col.trim() == '')
                                    indent = 0;
                                else
                                    return table.error = {
                                        msg: 'Invalid indentation',
                                        line: lineIdx
                                    };

                            if (table_fn && lineIdx == cursorPos.line) {
                                if (temp < cursorPos.ch && temp + table.cols[idx].width >= cursorPos.ch) {
                                    table.cursorPos.line = cursorPos.line;
                                    table.cursorPos.ch = cursorPos.ch;
                                    table.cursorPos.tableIdx = table.rows.length;
                                    table.cursorPos.colIdx = idx;
                                    table.cursorPos.colPos = cursorPos.ch - temp + 1 - table.cols[idx].indent;
                                };
                                temp += col.length + 1;
                            }

                            col = col.substr(table.cols[idx].indent).replace(TRAILING_SPACES, '');
                            var width = col.length;
                            if (width > table.cols[idx].width)
                                table.cols[idx].width = width;

                            return col;

                        })
                    });
                }

            });

        }

        function flush_table_example(lineIdx) {
            if (table && table.cursorPos.example_start_lineIdx) {
                if (table.cursorPos.line) {
                    if (!table.cursorPos.lineIdx) {
                        table.cursorPos.lineIdx = table.cursorPos.line;
                        table.cursorPos.example_end_lineIdx = lineIdx-1;
                        table.cursorPos.example_end_tableIdx = table.rows.length-1;
                    }
                } else {
                    table.cursorPos.example_start_lineIdx = null;
                    table.cursorPos.example_start_tableIdx = null;
                }
            }
        }

        function flush_table(table_end) {
            if (!table)
                return;

            if (table.error)
                return mark_table_error();

            flush_table_example(table_end);
            table.table_end = table_end;
            var lineWidth;
            if (table_fn && cursorPos.line >= table.table_start && cursorPos.line <= table_end)
                table_fn(table, lines, table.cursorPos);

            for (var i = 0; i < table.rows.length; i++) {
                var row = table.rows[i];
                var lineIdx = row.lineIdx;
                var row = row.cols.map(
                    function (col, idx) {
                        var r;

                        if (idx == 0)
                            r = ['    '];
                        else
                            r = [' ', row.sep, ' '];

                        var a = r.join('').length;
                        r.push(col);
                        var b = r.join('').length;
                        r.push(spaces(table.cols[idx].width - col.length));
                        var c = r.join('').length;
                        var t = (table.cols[idx].width - col.length);
                        var r = r.join('');
                        return r;
                    }
                ).join('');
                lineWidth = row.length;
                lines[lineIdx] = row.replace(TRAILING_SPACES, '');
            }

            var dash;
            for (var i = 0; i < table.dashed.length; i++) {
                var lineIdx = table.dashed[i].lineIdx;
                if (!dash) {
                    dash = ['    '];
                    for (var j = 4; j < lineWidth; j++)
                        dash.push('-');
                    dash = dash.join('');
                }
                lines[lineIdx] = dash;
            }

            table = null;
        }

        var spaces$cache;

        function spaces(len) {
            if (len < 1)
                return '';
            if (spaces$cache && len <= spaces$cache.length)
                return spaces$cache.substr(0, len);
            var r = [];
            while (len--) r.push(' ');
            spaces$cache = r.join('');
            return spaces$cache;
        }

        function doindent(start, end, indent) {
            if (start == -1)
                start = end;
            for (var lineIdx = start; lineIdx <= end; lineIdx++) {
                lines[lineIdx] = indent + lines[lineIdx].trim();
            }
        }
    }

    function extraKeys() {

        //    EditorManager.on('activeEditorChange', function () {
        //      var doc = DocumentManager.getCurrentDocument();
        //      if (doc.getLanguage().getId() == 'gherkin') {
        //
        //        debugger;
        //
        //        var editor = EditorManager.getCurrentFullEditor();
        //        editor._codeMirror.addEventListener('keydown', function (e) {
        //          e.preventDefault();
        //          if (e.keyCode == 15)
        //            doNewLine(doc, editor);
        //        })
        //
        //      }
        //    });


        document.addEventListener('keypress', function (e) {
            var doc = DocumentManager.getCurrentDocument();
            if (doc.getLanguage().getId() == 'gherkin') {
                if (e.keyCode == 16)
                    doInsertLine(doc);
            }
        });

        function doInsertLine(document) {

            format(document, function (table, lines, cursorPos) {
                if (!cursorPos.example_start_tableIdx)
                    return;
                table.dashed.forEach(function (row) {
                    if (row.lineIdx >= cursorPos.line)
                        row.lineIdx++;
                });
                var rowA = table.rows[cursorPos.tableIdx];
                var rowB = table.rows[cursorPos.tableIdx + 1];
                var rowL = {
                    lineIdx: cursorPos.example_end_lineIdx + 1,
                    sep: rowA.sep,
                    cols: rowA.cols.map(function (col) {
                        return '';
                    })
                };
                table.rows.splice(cursorPos.example_end_tableIdx+1, 0, rowL);
                lines.splice(cursorPos.example_end_lineIdx + 1, 0, '');
                for (var row_idx = cursorPos.example_end_tableIdx; row_idx > cursorPos.tableIdx; row_idx--) {
                    table.rows[row_idx+1].cols[cursorPos.colIdx] = table.rows[row_idx].cols[cursorPos.colIdx];
                }
                var s=rowA.cols[cursorPos.colIdx];
                rowA.cols[cursorPos.colIdx]=s.substr(0,cursorPos.colPos);
                rowB.cols[cursorPos.colIdx]=s.substr(cursorPos.colPos);
                for (var row_idx = cursorPos.example_end_tableIdx + 2; row_idx < table.rows.length; row_idx++)
                    table.rows[row_idx].lineIdx++;
            });
        }


        //        function doDeleteLine(document) {
        //
        //            format(document, function (table, lines, cursorPos) {
        //                var start_example_idx, end_example_idx, end_table_idx;
        //                table.rows.forEach(function (row, idx) {
        //                    if (!start_example_idx) {
        //                        if (row.lineIdx == cursorPos.line)
        //                            start_example_idx = idx;
        //                    } else {
        //                        if (row.lineIdx > cursorPos.line)
        //                            row.lineIdx--;
        //                        end_table_idx = idx;
        //                        if (end_example_idx && table.rows[end_example_idx].lineIdx != row.lineIdx - 1)
        //                            return;
        //                        end_example_idx = idx;
        //                    }
        //                });
        //
        //                if (!start_example_idx)
        //                    return;
        //                table.dashed.forEach(function (row) {
        //                    if (row.lineIdx >= cursorPos.line)
        //                        row.lineIdx--;
        //                });
        //                var rowA = table.rows[cursorPos.start_example_idx];
        //                var rowB = {
        //                    lineIdx: table.rows[cursorPos.start_example_idx].lineIdx + 1,
        //                    cols: rowA.cols.map(function (col) {
        //                        return '';
        //                    }),
        //                    sep: rowA.sep
        //                };
        //                table.rows.splice(start_example_idx, 0, rowB);
        //                lines.splice(table.rows[end_example_idx].lineIdx + 1, 0, '');
        //            });
        //        }

        //    debugger;
        //    cm.defaults.extraKeys = {
        //      Enter: onNewLine,
        //      Tab: function (cm) {
        //        var spaces = Array(cm.getOption("indentUnit") + 1).join(" ");
        //        cm.replaceSelection(spaces);
        //      }
        //    };
    }

    function onNewLine(cm) {
        debugger;
        cm.replaceSelection("\n", "end");
    }
});
