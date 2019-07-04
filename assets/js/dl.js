/* jshint esversion: 8 */
/* jshint browser: true */

async function awaitForEach(array, cb) {
    "use strict";
    var i;
    for (i = 0; i < array.length; ++i) {
        await cb(array[i]);
    }
}
async function apicall(url) {
    "use strict";
    window.console.info("API call: " + url);
    var api = new XMLHttpRequest();
    var prms = new Promise((resolve, reject) => {
        api.onreadystatechange = () => {
            //window.console.info("" + api.readyState + " - " + api.status);
            if (api.readyState == 4) {
                if (api.status == 200) {
                    resolve(JSON.parse(api.response));
                }
                else {
                    resolve(null);
                }
            }
        };
    });
    api.open("GET", url);
    api.send();
    return prms;
}
async function getroot(org, repo, revision) {
    "use strict";
    var f = await apicall("https://api.github.com/repos/" + org + "/" + repo + "/git/trees/" + revision);
    f.path = "/";
    return f;
}
async function subtree(tree, folder) {
    "use strict";
    var stree = null;
    var path = null;
    if (tree.path) {
        path = tree.path + folder + "/";
        //window.console.info("Getting folder " + path);
    }
    tree.tree.forEach(element => {
        if (stree) return;
        if (element.path == folder) {
            stree = apicall(element.url);
        }
    });
    stree = await stree;
    if (path) {
        stree.path = path;
    }
    return stree;
}
async function cd(root, path) {
    "use strict";
    var fnames = path.split("/");
    var fname = fnames.shift();
    var folder = await subtree(root, fname);
    if (!folder) {
        window.console.warn("Folder doesn't exist: " + (root.path ? root.path : "") + fname);
        return null;
    }
    if (fnames.length > 0) {
        return await cd(folder, fnames.join('/'));
    }
    return folder;
}
async function blobinfo(path, blob) {
    "use strict";
    //window.console.info("Getting info on blob " + path + blob.path);
    var info = {};
    var dotat = blob.path.lastIndexOf('.');
    switch (dotat) {
        case -1:
        case 0:
            info.filename = blob.path;
            info.ext = "";
            break;
        default:
            info.filename = blob.path.substring(0, dotat);
            info.ext = blob.path.substring(dotat + 1);
            break;
    }
    info.path = path;
    info.blob = blob;
    var parts = info.filename.split('-');
    info.category = "unknown";
    switch (parts[0]) {
        case "lineage":
            // lineage-<version>-<builddate>-<releasetype>-<device>.zip
            if (parts.length == 5) {
                switch (info.ext) {
                    case "ffu":
                    case "zip":
                        info.type = info.ext;
                        break;
                    case "md5":
                        info.type = "checksum";
                        parts[4] = parts[4].split('.')[0];
                        break;
                    default:
                        return info;
                }
                info.category = "ROM";
                info.name = "LineageOS " + parts[1];
                info.date = parts[2];
                info.variant = parts[3];
                info.device = parts[4];
            }
            break;
        case "twrp":
            // twrp-<device>-<builddate>.img
            if (parts.length == 3) {
                switch (info.ext) {
                    case "img":
                        info.type = "partition";
                        break;
                    case "zip":
                        info.type = info.ext;
                        break;
                    case "md5":
                        info.type = "checksum";
                        parts[4] = parts[4].split('.')[0];
                        break;
                    default:
                        return info;
                }
                info.category = "recovery";
                info.name = "TWRP";
                info.date = parts[2];
                info.device = parts[1];
            }
            break;
        default:
            window.console.info("Not sure what this thing is: " + blob.path);
            break;
    }
    return info;
}
async function listblobs(root, recursive) {
    "use strict";
    var blobs = [];
    await awaitForEach(root.tree, async element => {
        switch (element.type) {
            case "blob":
                blobs.push(await blobinfo((root.path ? root.path : ""), element));
                break;
            case "tree":
                if (recursive) {
                    blobs = blobs.concat(await listblobs(await subtree(root, element.path), true));
                }
                break;
            default:
                window.console.info("Not sure what a " + element.type + " is (" + (root.path ? root.path : "") + element.path + ")");
                break;
        }
    });
    return blobs;
}

function appendAll(node, children) {
    children.forEach(child => {
        node.appendChild(child);
    });
}

function copy_attributes(from, to) {
    var i;
    for (i = 0; i < from.attributes.length; ++i) {
        var attribute = from.attributes[i];
        switch (attribute.name) {
            case "id":
                break;
            default:
                to.setAttribute(attribute.name, attribute.value);
        }
    }
}

function dataset_group(dataset, propertyName) {
    var grouped = [];
    dataset.forEach(data => {
        var value = "dljs_" + data[propertyName];
        if (!grouped[value]) {
            grouped[value] = [];
            grouped.push(grouped[value]);
        }
        grouped[value].push(data);
    });
    window.console.info(grouped);
    return grouped;
}

function generate_dom(template, dataset) {
    var nodes = [];

    template.childNodes.forEach(child => {
        switch (child.nodeName) {
            case "#text":
                nodes.push(document.createTextNode(child.nodeValue));
                break;
            case "ECHO":
                var value = dataset;
                //window.console.info(value);
                if (child.hasAttribute("dljs_index")){
                    value = value[parseInt(child.getAttribute("dljs_index"))];
                }
                //window.console.info(value);
                if (child.hasAttribute("dljs_property")){
                    value = value[child.getAttribute("dljs_property")];
                }
                //window.console.info(value);
                nodes.push(document.createTextNode(value));
                break;
            case "FOREACH":
                var dataset2 = dataset;
                if (child.hasAttribute("dljs_group")) {
                    window.console.info("ForEach group = " + child.getAttribute("dljs_group"));
                    dataset2 = dataset_group(dataset2, child.getAttribute("dljs_group"));
                }
                dataset2.forEach(data => {
                    //window.console.info(data);
                    nodes = nodes.concat(generate_dom(child, data));
                });
                window.console.info("END ForEach");
                break;
            default:
                var clone = document.createElement(child.tagName);
                copy_attributes(child, clone);
                appendAll(clone, generate_dom(child, dataset));
                nodes.push(clone);
                break;
        }
    });

    return nodes;
}

async function downloads_generate(parent) {
    var template = document.getElementById(parent.getAttribute("dljs_template"));
    var dataset = [];
    await awaitForEach(parent.getAttribute("dljs_path").split(';'), async path => {
        var parts = path.split(':');
        dataset = dataset.concat(await listblobs(await cd(await getroot(parts[0], parts[1], parts[2]), parts[3]), parts.length > 4));
    });
    removeEveryChild(parent);
    appendAll(parent, generate_dom(template, dataset));
}

var pages;

function removeEveryChild(node) {
    while (node.childNodes.length) {
        node.removeChild(node.childNodes[0]);
    }
}

async function reload_files(e) {
    "use strict";
    if (!pages) {
        var flags = document.getElementsByTagName("dljs_flag");
        pages = [];
        await awaitForEach(flags, async element => {
            var page = element.parentElement;
            page.setAttribute("dljs_path", element.getAttribute("dljs_path"));
            page.setAttribute("dljs_template", element.getAttribute("dljs_template"));
            pages.push(page);
        });
    }
    await awaitForEach(pages, async element => {
        await downloads_generate(element);
    });
}
document.addEventListener("DOMContentLoaded", reload_files);
