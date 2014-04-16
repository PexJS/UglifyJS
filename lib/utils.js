var jsp = require("./parse-js"),
    pro = require("./process"),
    consolidator = require("./consolidator"),
    dict = require("./dictionary"),
    sys = require("util"),
    fs = require("fs");

var existsSync = fs.existsSync || require("path").existsSync;

function show_copyright(comments) {
        var ret = "";
        for (var i = 0; i < comments.length; ++i) {
                var c = comments[i];
                if (c.type == "comment1") {
                        ret += "//" + c.value + "\n";
                } else {
                        ret += "/*" + c.value + "*/";
                }
        }
        return ret;
};

function squeeze_it(code, options) {
        var result = "";
        if (options.show_copyright) {
                var tok = jsp.tokenizer(code), c;
                c = tok();
                result += show_copyright(c.comments_before);
        }
        var verbose = options.verbose;
        try {
                var ast = time_it("parse", function(){ return jsp.parse(code); }, verbose);
                if (options.consolidate) ast = time_it("consolidate", function(){
                        return consolidator.ast_consolidate(ast);
                }, verbose);
                if (options.lift_vars) {
                        ast = time_it("lift", function(){ return pro.ast_lift_variables(ast); }, verbose);
                }
                if (options.mangle) ast = time_it("mangle", function(){
                        var vars_in_string = options.vars_in_string || [];
                        if (options.tokenfile) {
                                // add tokens in tokenfile to mangle them
                                vars_in_string.push.apply(vars_in_string, readlines(options.tokenfile));
                        }
                        return pro.ast_mangle(ast, {
                                toplevel        : options.mangle_toplevel,
                                defines         : options.defines,
                                except          : options.reserved_names,
                                no_functions    : options.no_mangle_functions,
                                mangle_uniquely : options.mangle_uniquely,
                                ignore_eval     : options.ignore_eval,
                                property_maps   : options.property_maps,
                                vars_in_string  : vars_in_string
                        });
                }, verbose);
                if (options.squeeze) ast = time_it("squeeze", function(){
                        ast = pro.ast_squeeze(ast, {
                                make_seqs  : options.make_seqs,
                                dead_code  : options.dead_code,
                                keep_comps : !options.unsafe
                        });
                        if (options.unsafe)
                                ast = pro.ast_squeeze_more(ast);
                        return ast;
                }, verbose);
                if (options.ast)
                        return sys.inspect(ast, null, null);
                result += time_it("generate", function(){ return pro.gen_code(ast, options.codegen_options) }, verbose);
                if (!options.codegen_options.beautify && options.max_line_length) {
                        result = time_it("split", function(){ return pro.split_lines(result, options.max_line_length) }, verbose);
                }
                return result;
        } catch(ex) {
                sys.debug(ex.stack);
                sys.debug(sys.inspect(ex));
                sys.debug(JSON.stringify(ex));
                process.exit(1);
        }
};

function extract_tokens(code) {
        var ast = jsp.parse(code);
        return pro.ast_extract_tokens(ast);
};

function make_tokenfile_info(code, options) {
        options = options || {};
        var new_tokenfile_info = make_tokenfile_info_from_code(code, options);

        var existing_tokenfile_info = [];
        if (options.tokenfile) {
                var lines = readlines(options.tokenfile);
                existing_tokenfile_info.push.apply(
                        existing_tokenfile_info,
                        make_tokenfile_info_from_array(lines)
                );
        }
        if (options.tokens) {
                var tokens = options.tokens.split(",");
                existing_tokenfile_info.push.apply(
                        existing_tokenfile_info,
                        make_tokenfile_info_from_array(tokens)
                );
        }

        var merged_info = merge_tokenfile_info(existing_tokenfile_info, new_tokenfile_info);
        return options.diff ? merged_info.diff : merged_info.whole;
};

function readlines(filename) {
        if (!existsSync(filename)) {
                console.error("no such file: " + filename);
                process.exit(1);
        }
        return fs.readFileSync(filename, "utf8").trim().split(/\r?\n/);
};

// merge two information and make a information of their difference
// e.g. merge_tokenfile_info(
//          [ { token: "a", message: "a # foo" }, { token: "c", message: "#c" } ],
//          [ { token: "a", message: "a # bar" }, { token: "b", message: "b" } ]
//      );
//      // => { whole: [ "a # foo", "b" ], diff: [ "- #c", "+ b" ] }
function merge_tokenfile_info(from_info, to_info) {
        function sort_by_token(a, b) {
                return a.token.localeCompare(b.token);
        };

        // copy arrays and sort them
        from_info = from_info.slice().sort(sort_by_token);
        to_info = to_info.slice().sort(sort_by_token);

        var whole_lines = [];
        var diff_lines = [];
        var from_cursor = 0;
        var to_cursor = 0;
        while (from_cursor < from_info.length && to_cursor < to_info.length) {
                if (from_info[from_cursor].token === to_info[to_cursor].token) {
                        // use the data of from_info (existing_tokenfile_info)
                        whole_lines.push(from_info[from_cursor].message);
                        ++from_cursor;
                        ++to_cursor;
                        continue;
                }
                while (from_info[from_cursor].token > to_info[to_cursor].token) {
                        whole_lines.push(to_info[to_cursor].message);
                        diff_lines.push("+ " + to_info[to_cursor].message);
                        if (++to_cursor === to_info.length) {
                                break;
                        }
                }
                while (from_info[from_cursor].token < to_info[to_cursor].token) {
                        diff_lines.push("- " + from_info[from_cursor].message);
                        if (++from_cursor === from_info.length) {
                                break;
                        }
                }
        }

        // add remaining lines
        for (; from_cursor < from_info.length; ++from_cursor) {
                diff_lines.push("- " + from_info[from_cursor].message);
        }
        for (; to_cursor < to_info.length; ++to_cursor) {
                whole_lines.push(to_info[to_cursor].message);
                diff_lines.push("+ " + to_info[to_cursor].message);
        }

        return {
                diff: diff_lines.sort(function(a, b) {
                        // remove prefixes ('+ ' and '- ')
                        return a.slice(2).localeCompare(b.slice(2));
                }),
                whole: whole_lines.sort()
        };
};

function make_tokenfile_info_from_array(chunks) {
        var tokenfile_info = [];
        chunks.forEach(function(chunk) {
                if (!chunk.trim()) {
                        return;
                }
                var token = extract_token_from_chunk(chunk);
                tokenfile_info.push({ token: token, message: chunk });
        });
        return tokenfile_info;
};

function make_tokenfile_info_from_code(code, options) {

        // make a hash whose key is a token and value is an array of token types
        function make_reserved_token_types(reserved_names) {
                if (reserved_names) {
                        dict.USED_TOKENS.Custom_Reserved = jsp.array_to_hash(reserved_names);
                }

                var reserved_token_types = {};
                // override Object properties with arrays
                // for example, if token is 'hasOwnProperty',
                // reserved_token_types[token] will be truthy but reserved_token_types[token].push() will be failed
                Object.getOwnPropertyNames(Object.prototype).forEach(function(prop) {
                        reserved_token_types[prop] = [];
                });

                // register reserved tokens with the reasons why they are reserved
                for (var token_type in dict.USED_TOKENS) {
                        for (var token in dict.USED_TOKENS[token_type]) {
                                if (!reserved_token_types[token]) {
                                        reserved_token_types[token] = [];
                                }
                                reserved_token_types[token].push(token_type);
                        }
                }
                return reserved_token_types;
        };

        var reserved_token_types = make_reserved_token_types(options.reserved_names);
        var tokens = extract_tokens(code);

        var tokefile_info = [];
        var min_length = options.min_length || 2;
        tokens.forEach(function(token) {
                var comment;
                if (reserved_token_types[token] && reserved_token_types[token].length > 0) {
                        comment = ": used in " + reserved_token_types[token].join(", ");
                } else if (!pro.is_identifier(token)) {
                        comment = ": not identifier";
                } else if (min_length > token.length) {
                        comment = ": length of token is less than " + min_length;
                }
                var message = token;
                if (comment) {
                        // this token should not be mangled, so prepend '#' to comment out the message
                        message = "#" + token + comment;
                }
                tokefile_info.push({ token: token, message: message });
        });

        return tokefile_info;
};

function make_mapping(options) {
        var cname = -1;
        var mangled = {};
        var rev_mangled = {};
        options = options || {};

        function next_mangled() {
                while (1) {
                        var m = pro.base54(++cname);
                        if (rev_mangled[m] || !pro.is_identifier(m)) {
                                continue;
                        }
                        return m;
                }
        };

        var mapping = options.mapping || [];
        if (options.mapping_file) {
                mapping.push.apply(mapping, readlines(options.mapping_file));
        }
        // register mapping information
        // e.g. 'foo:a' means 'foo' is converted to 'a'
        mapping.sort().forEach(function(map) {
                var array = map.split(":");
                mangled[array[0]] = array[1];
                rev_mangled[array[1]] = array[0];
        });

        var chunks = options.tokens || [];
        if (options.tokenfile) {
                chunks.push.apply(chunks, readlines(options.tokenfile));
        }
        chunks.sort().forEach(function(chunk) {
                chunk = chunk.trim();
                if (!chunk || chunk.substring(0, 1) === "#") {
                        // empty or commented out
                        return;
                }
                var token = extract_token_from_chunk(chunk);
                if (mangled[token]) {
                        // already mangled
                        return;
                }
                var m = next_mangled(token);
                mangled[token] = m;
                rev_mangled[m] = token;
        });

        var new_mapping = [];
        Object.keys(mangled).sort().forEach(function(token) {
                new_mapping.push(token + ":" + mangled[token]);
        });
        return new_mapping;
};

function extract_token_from_chunk(chunk) {
        // extract token
        // e.g. '#foo' => 'foo', 'bar # comment' => 'bar'
        return chunk.match(/[\w$]+/)[0];
};

function time_it(name, cont, verbose) {
        if (!verbose)
                return cont();
        var t1 = new Date().getTime();
        try { return cont(); }
        finally { sys.debug("// " + name + ": " + ((new Date().getTime() - t1) / 1000).toFixed(3) + " sec."); }
};

/* -----[ Exports ]----- */

exports.squeeze_it = squeeze_it;
exports.extract_tokens = extract_tokens;
exports.make_tokenfile_info = make_tokenfile_info;
exports.make_mapping = make_mapping;
