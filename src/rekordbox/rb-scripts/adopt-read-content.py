"""rb-adopt read leg — every content row + joined names as one JSON array.

argv: <dbPath>  — a COPY of the OneLibrary master (CrateDeck refuses the
live DB; the copy discipline lives in the caller).
"""

import json
import sys
from typing import Any

from pyrekordbox import Rekordbox6Database as R  # type: ignore[import-not-found]
from sqlalchemy import inspect


def scalar(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def lookup(rows: Any, value_name: str) -> dict[str, Any]:
    return {str(row.ID): scalar(getattr(row, value_name, None)) for row in rows}


def main() -> None:
    db = R(sys.argv[1])
    out: list[dict[str, Any]] = []
    try:
        artists = lookup(db.get_artist(), "Name")
        albums = lookup(db.get_album(), "Name")
        genres = lookup(db.get_genre(), "Name")
        keys = lookup(db.get_key(), "ScaleName")
        labels = lookup(db.get_label(), "Name")
        for content in db.get_content():
            metadata: dict[str, Any] = {
                column.key: scalar(getattr(content, column.key, None))
                for column in inspect(content.__class__).columns
            }
            metadata.update(
                {
                    "ArtistName": artists.get(str(content.ArtistID)),
                    "AlbumName": albums.get(str(content.AlbumID)),
                    "GenreName": genres.get(str(content.GenreID)),
                    "KeyName": keys.get(str(content.KeyID)),
                    "LabelName": labels.get(str(content.LabelID)),
                    "RemixerName": artists.get(str(content.RemixerID)),
                }
            )
            out.append(
                {
                    "contentId": str(content.ID),
                    "folderPath": content.FolderPath or "",
                    "title": content.Title,
                    "artist": metadata["ArtistName"],
                    "album": metadata["AlbumName"],
                    "genre": metadata["GenreName"],
                    "durationS": content.Length,
                    "bitrateKbps": content.BitRate,
                    "fileSizeBytes": content.FileSize,
                    "year": str(content.ReleaseYear) if content.ReleaseYear else None,
                    "metadata": metadata,
                }
            )
        print(json.dumps(out, ensure_ascii=False))
    finally:
        db.close()


if __name__ == "__main__":
    main()
