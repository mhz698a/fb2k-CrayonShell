export const PLAYLIST_FORMATS = {
    duration:
        "$ifgreater($div(%length_seconds%,3600),9," +
        "$div(%length_seconds%,3600)," +
        "0$div(%length_seconds%,3600))" +
        ":" +
        "$ifgreater($mod($div(%length_seconds%,60),60),9," +
        "$mod($div(%length_seconds%,60),60)," +
        "0$mod($div(%length_seconds%,60),60))" +
        ":" +
        "$ifgreater($mod(%length_seconds%,60),9," +
        "$mod(%length_seconds%,60)," +
        "0$mod(%length_seconds%,60))",
    details:
        "$if(%length%,$substr(%path%,14,17). ,00. )" +
        "$if(%length%,%filename% ,$if(%Artist%,%Artist% - )%Title%)" +
        "$if($strstr(%filename_ext%,.mp4),$ascii('[')Video$ascii(']') ,)" +
        "$ifgreater(%totaltracks%,1,$ascii('[[')%title%$ascii(']]') ,)"
};
