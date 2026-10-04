using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Frosty.Core;
using FrostySdk;
using FrostySdk.Ebx;
using FrostySdk.IO;
using FrostySdk.Managers;
using FrostySdk.Managers.Entries;

namespace PlayDump
{
    // Phase 0 oracle: one .fbproject with two isolated edits to the Seahawks offense, to learn which data the game reads.
    //  A) EBX only:      Shotgun Y-Trips Wk "Slants" -> left outside WR runs WR_Run90for30 (a go) instead of his slant.
    //  B) protobuf only: Shotgun Y-Trips Wk "Curls"  -> left outside WR's curl stem 10 yds -> 30 yds, patched inside
    //                    Madden_Seahawks_Offense.protobufString (the EBX Curls play and its assignments are untouched).
    internal static class Oracle
    {
        const string SlantsPlay = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/Shotgun/Y_Trips_Wk/Slants";
        const string SlantPad = "football/Gameplay/playbooks/PlayLibrary/Assignments/RunRoute/WR_Run90for03_CutR45_Run45for20_Slant90_2";
        const string GoPad = "football/Gameplay/playbooks/PlayLibrary/Assignments/RunRoute/WR_Run90for30";
        const string Playbook = "football/Gameplay/Playbooks/GameSheets/Madden_Seahawks_Offense";
        // Located with tools/protofind.mjs: play 7663 (Curls), positionAssignId 5242, first RunRoute (#3.#6.#1 distance).
        const int CurlDistanceOffset = 307429;

        public static int Run(AssetManager am, string projectPath)
        {
            EditSlants(am);
            PatchCurlsProtobuf(am);

            var project = new FrostyProject();
            project.ModSettings.Title = "PB Studio - Phase 0 oracle";
            project.ModSettings.Author = "2026 Playbook";
            project.ModSettings.Version = "0.0.1";
            project.ModSettings.Description = "Seahawks O, Gun Y-Trips Wk: Slants (EBX edit: left WR runs a go) and Curls (protobuf edit: left WR curl at 30 yds).";
            project.Save(projectPath, updateDirtyState: false);
            Console.Error.WriteLine("saved " + projectPath);
            return 0;
        }

        static void EditSlants(AssetManager am)
        {
            EbxAssetEntry playEntry = am.GetEbxEntry(SlantsPlay);
            EbxAssetEntry goEntry = am.GetEbxEntry(GoPad);
            EbxAssetEntry slantEntry = am.GetEbxEntry(SlantPad);
            EbxAsset play = am.GetEbx(playEntry);
            dynamic root = play.RootObject;
            List<PointerRef> pads = root.positionAssignmentDefines;

            int idx = pads.FindIndex(p => p.Type == PointerRefType.External && p.External.FileGuid == slantEntry.Guid);
            if (idx < 0) throw new InvalidOperationException("slant assignment not found in Slants");
            Guid goRoot = am.GetEbx(goEntry).RootInstanceGuid;
            pads[idx] = new PointerRef(new EbxImportReference { FileGuid = goEntry.Guid, ClassGuid = goRoot });
            play.AddDependency(goEntry.Guid);
            am.ModifyEbx(playEntry.Name, play);
            Console.Error.WriteLine($"A) {playEntry.Name}: positionAssignmentDefines[{idx}] slant -> {goEntry.Name}");
        }

        static void PatchCurlsProtobuf(AssetManager am)
        {
            EbxAssetEntry entry = am.GetEbxEntry(Playbook);
            EbxAsset book = am.GetEbx(entry);
            dynamic root = book.RootObject;
            byte[] pb = Convert.FromBase64String(((CString)root.protobufString).ToString());

            // Guard: key byte 0x0D = field 1, wire type 5 (f32), and the current value must be the 10-yard stem.
            if (pb[CurlDistanceOffset - 1] != 0x0D || BitConverter.ToSingle(pb, CurlDistanceOffset) != 10f)
                throw new InvalidOperationException("protobuf layout differs from the analyzed dump; refusing to patch");
            Buffer.BlockCopy(BitConverter.GetBytes(30f), 0, pb, CurlDistanceOffset, 4);

            root.protobufString = new CString(Convert.ToBase64String(pb));
            am.ModifyEbx(entry.Name, book);
            Console.Error.WriteLine($"B) {entry.Name}: protobuf @{CurlDistanceOffset} 10 -> 30");
        }
    }
}
