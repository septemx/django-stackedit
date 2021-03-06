define([
    "jquery",
    "underscore",
    "classes/Extension",
    "text!html/scrollLinkSettingsBlock.html"
], function($, _, Extension, scrollLinkSettingsBlockHTML) {

    var scrollLink = new Extension("scrollLink", "Scroll Link", true, true, true);
    scrollLink.settingsBlock = scrollLinkSettingsBlockHTML;

    var aceEditor;
    scrollLink.onAceCreated = function(aceEditorParam) {
        aceEditor = aceEditorParam;
    };

    var sectionList;
    scrollLink.onSectionsCreated = function(sectionListParam) {
        sectionList = sectionListParam;
    };
    
    var offsetBegin = 0;
    scrollLink.onMarkdownTrim = function(offsetBeginParam) {
        offsetBegin = offsetBeginParam;
    };

    var $previewElt;
    var mdSectionList = [];
    var htmlSectionList = [];
    var lastEditorScrollTop;
    var lastPreviewScrollTop;
    var buildSections = _.debounce(function() {

        mdSectionList = [];
        var mdTextOffset = 0;
        var mdSectionOffset = 0;
        var firstSectionOffset = offsetBegin;
        _.each(sectionList, function(section) {
            mdTextOffset += section.text.length + firstSectionOffset;
            firstSectionOffset = 0;
            var documentPosition = aceEditor.session.doc.indexToPosition(mdTextOffset);
            var screenPosition = aceEditor.session.documentToScreenPosition(documentPosition.row, documentPosition.column);
            var newSectionOffset = screenPosition.row * aceEditor.renderer.lineHeight;
            var sectionHeight = newSectionOffset - mdSectionOffset;
            mdSectionList.push({
                startOffset: mdSectionOffset,
                endOffset: newSectionOffset,
                height: sectionHeight
            });
            mdSectionOffset = newSectionOffset;
        });

        // Try to find corresponding sections in the preview
        htmlSectionList = [];
        var htmlSectionOffset;
        var previewScrollTop = $previewElt.scrollTop();
        $previewElt.find(".preview-content > .se-section-delimiter").each(function() {
            if(htmlSectionOffset === undefined) {
                // Force start to 0 for the first section
                htmlSectionOffset = 0;
                return;
            }
            var $delimiterElt = $(this);
            // Consider div scroll position
            var newSectionOffset = $delimiterElt.position().top + previewScrollTop;
            htmlSectionList.push({
                startOffset: htmlSectionOffset,
                endOffset: newSectionOffset,
                height: newSectionOffset - htmlSectionOffset
            });
            htmlSectionOffset = newSectionOffset;
        });
        // Last section
        var scrollHeight = $previewElt.prop('scrollHeight');
        htmlSectionList.push({
            startOffset: htmlSectionOffset,
            endOffset: scrollHeight,
            height: scrollHeight - htmlSectionOffset
        });

        // apply Scroll Link (-10 to have a gap > 9px)
        lastEditorScrollTop = -10;
        lastPreviewScrollTop = -10;
        doScrollLink();
    }, 500);

    var isScrollEditor = false;
    var isScrollPreview = false;
    var isEditorMoving = false;
    var isPreviewMoving = false;
    var doScrollLink = _.debounce(function() {
        if(mdSectionList.length === 0 || mdSectionList.length !== htmlSectionList.length) {
            // Delay
            doScrollLink();
            return;
        }
        var editorScrollTop = aceEditor.renderer.getScrollTop();
        var previewScrollTop = $previewElt.scrollTop();
        function getDestScrollTop(srcScrollTop, srcSectionList, destSectionList) {
            // Find the section corresponding to the offset
            var sectionIndex;
            var srcSection = _.find(srcSectionList, function(section, index) {
                sectionIndex = index;
                return srcScrollTop < section.endOffset;
            });
            if(srcSection === undefined) {
                // Something wrong in the algorithm...
                return;
            }
            var posInSection = (srcScrollTop - srcSection.startOffset) / (srcSection.height || 1);
            var destSection = destSectionList[sectionIndex];
            return destSection.startOffset + destSection.height * posInSection;
        }
        var destScrollTop;
        // Perform the animation if diff > 9px
        if(isScrollEditor === true && Math.abs(editorScrollTop - lastEditorScrollTop) > 9) {
            isScrollEditor = false;
            // Animate the preview
            lastEditorScrollTop = editorScrollTop;
            destScrollTop = getDestScrollTop(editorScrollTop, mdSectionList, htmlSectionList);
            destScrollTop = _.min([
                destScrollTop,
                $previewElt.prop('scrollHeight') - $previewElt.outerHeight()
            ]);
            if(Math.abs(destScrollTop - previewScrollTop) <= 9) {
                // Skip the animation if diff is <= 9
                lastPreviewScrollTop = previewScrollTop;
            }
            else {
                isPreviewMoving = true;
                $previewElt.animate({
                    scrollTop: destScrollTop
                }, {
                    easing: 'easeOutSine',
                    complete: function() {
                        lastPreviewScrollTop = destScrollTop;
                    },
                    always: function() {
                        _.defer(function() {
                            isPreviewMoving = false;
                        });
                    }
                });
            }
        }
        else if(isScrollPreview === true && Math.abs(previewScrollTop - lastPreviewScrollTop) > 9) {
            isScrollPreview = false;
            // Animate the editor
            lastPreviewScrollTop = previewScrollTop;
            destScrollTop = getDestScrollTop(previewScrollTop, htmlSectionList, mdSectionList);
            destScrollTop = _.min([
                destScrollTop,
                aceEditor.session.getScreenLength() * aceEditor.renderer.lineHeight + aceEditor.renderer.scrollMargin.bottom - aceEditor.renderer.$size.scrollerHeight
            ]);
            // If negative, set it to zero
            destScrollTop < 0 && (destScrollTop = 0);
            if(Math.abs(destScrollTop - editorScrollTop) <= 9) {
                // Skip the animation if diff is <= 9
                lastEditorScrollTop = editorScrollTop;
            }
            else {
                isEditorMoving = true;
                $("<div>").animate({
                    value: destScrollTop - editorScrollTop
                }, {
                    easing: 'easeOutSine',
                    step: function(now) {
                        aceEditor.session.setScrollTop(editorScrollTop + now);
                    },
                    complete: function() {
                        lastEditorScrollTop = destScrollTop;
                    },
                    always: function() {
                        _.defer(function() {
                            isEditorMoving = false;
                        });
                    }
                });
            }
        }
    }, 500);

    scrollLink.onLayoutResize = function() {
        isScrollEditor = true;
        buildSections();
    };

    scrollLink.onFileClosed = function() {
        mdSectionList = [];
    };

    var scrollAdjust = false;
    scrollLink.onReady = function() {
        $previewElt = $(".preview-container");

        $previewElt.scroll(function() {
            if(isPreviewMoving === false && scrollAdjust === false) {
                isScrollPreview = true;
                isScrollEditor = false;
                doScrollLink();
            }
            scrollAdjust = false;
        });
        aceEditor.session.on("changeScrollTop", function() {
            if(isEditorMoving === false) {
                isScrollEditor = true;
                isScrollPreview = false;
                doScrollLink();
            }
        });
    };

    var $previewContentsElt;
    scrollLink.onPagedownConfigure = function(editor) {
        $previewContentsElt = $("#preview-contents");
        editor.getConverter().hooks.chain("postConversion", function(text) {
            // To avoid losing scrolling position before elements are fully
            // loaded
            $previewContentsElt.height($previewContentsElt.height());
            return text;
        });
    };

    scrollLink.onPreviewFinished = function() {
        // Now set the correct height
        var previousHeight = $previewContentsElt.height();
        $previewContentsElt.height("auto");
        var newHeight = $previewContentsElt.height();
        isScrollEditor = true;
        if(newHeight < previousHeight) {
            // We expect a scroll adjustment
            scrollAdjust = true;
        }
        buildSections();
    };

    return scrollLink;
});